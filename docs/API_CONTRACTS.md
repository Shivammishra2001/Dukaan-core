# API_CONTRACTS.md — DUKAAN Core

**Topology:** Browser (PWA) → **Next.js Route Handlers (BFF)** → **Strapi v5 custom controllers** → PostgreSQL.
The browser never calls Strapi directly. Paths below are the **BFF** paths the client uses; the Strapi path is noted where it differs.

**Base URL:** `/api`
**Auth:** httpOnly session cookie (browser → BFF); `Authorization: Bearer <service-token>` + `X-Store-Id` (BFF → Strapi).
**Content type:** `application/json; charset=utf-8`

---

## 0. Cross-Cutting Conventions

### 0.1 Standard headers

| Header | Direction | Purpose |
|---|---|---|
| `Idempotency-Key` | request | UUID; **required** on all mutating POSTs. Equals `client_uuid`. |
| `X-Device-Id` | request | Registered device UID. Required on POS/sync routes. |
| `X-App-Version` | request | Semver of the PWA; drives `STALE_APP_VERSION`. |
| `X-Client-Time` | request | ISO 8601 client clock, for skew telemetry. |
| `X-Trace-Id` | both | Propagated; echoed in errors. |
| `Idempotent-Replay` | response | `true` when a stored response is returned. |
| `X-Server-Time` | response | ISO 8601; client uses it to detect skew. |

### 0.2 Shared primitive types

```ts
type Paise = number;              // integer; ₹1.00 === 100
type DecimalString = string;      // exact decimal, e.g. "250.0000" — never a float
type ISODate = string;            // "2026-09-21"
type ISODateTime = string;        // "2026-09-21T09:15:30.000Z"
type UUID = string;
type DocumentId = string;         // Strapi v5 documentId

type BaseUnit = 'G' | 'ML' | 'PCS';
type UnitCode = BaseUnit | 'KG' | 'L' | 'QUINTAL' | 'DOZEN' | 'PACKET' | 'CARTON' | 'BORI' | 'CRATE';
type PaymentMethod = 'CASH' | 'CARD' | 'UPI' | 'WALLET' | 'CREDIT' | 'BANK_TRANSFER' | 'CHEQUE';
type SupplyType = 'INTRA_STATE' | 'INTER_STATE';
```

### 0.3 Envelope

```ts
interface ApiSuccess<T> { data: T; meta?: Record<string, unknown>; }

interface ApiError {
  error: {
    code: string;                                   // REQUIREMENTS §7.1 catalogue
    message: string;                                // developer-facing, English
    message_localized?: { hi?: string; en?: string };
    field?: string;                                 // "items[2].entered_qty"
    details?: Record<string, unknown>;
    resolutions?: ResolutionAction[];
    trace_id: string;
  };
}

interface ResolutionAction {
  action: 'POST_AS_NEGATIVE' | 'REALLOCATE_BATCH' | 'REDUCE_QTY' | 'CONVERT_TO_CASH'
        | 'APPROVE_OVERRIDE' | 'SUBSTITUTE_PRODUCT' | 'ACCEPT_SERVER_PRICE'
        | 'REASSIGN_SHIFT' | 'VOID';
  label: string;
  requires_permission?: string;
  payload_patch?: Record<string, unknown>;          // what to change before retrying
}
```

### 0.4 Status codes

| Code | Meaning |
|---|---|
| 200 | OK (includes idempotent replay) |
| 201 | Created |
| 202 | Accepted — queued/deferred (sync dependency pending) |
| 400 | Malformed payload / schema violation |
| 401 | Unauthenticated |
| 403 | Authenticated but lacking permission, or cross-store access |
| 404 | Not found **within the caller's store** |
| 409 | Conflict — idempotency in progress, or lock contention (`ERR_BUSY_RETRY`) |
| 422 | Business rule rejection (the interesting one — always carries `code` + `resolutions`) |
| 429 | Rate limited (`Retry-After` set) |
| 500 | Unexpected |

### 0.5 Supervisor override tokens
Any call that needs elevated authorisation carries `approval_token`: a single-use JWT (90 s TTL) obtained from `POST /api/auth/approval` by a user with the required permission, bound to `{ action, entity_type, entity_id?, store_id }`. The server verifies binding and burns the token inside the business transaction.

---

## 1. Bootstrap & Catalogue

### 1.1 `GET /api/pos/bootstrap`
Single call that makes the POS usable. Called on login and on app version change.

```ts
interface BootstrapResponse {
  server_time: ISODateTime;
  store: {
    id: DocumentId; code: string; name: string; name_local?: string;
    default_mode: 'KIRANA' | 'RETAIL';
    state_code: string; gstin?: string; currency: 'INR';
    invoice_prefix: string; financial_year: string;     // "2026-27"
    config: StoreConfig;                                 // DATABASE_SCHEMA §2.3
  };
  user: { id: DocumentId; full_name: string; role_code: string;
          permissions: string[]; discount_max_pct: number; preferred_language: 'hi' | 'en' };
  counter: { id: DocumentId; code: string; name: string } | null;
  open_shift: ShiftSummary | null;
  sync_cursors: SyncCursors;
  catalogue_snapshot_url?: string;    // signed URL to a gzipped full snapshot (first run)
  counts: { products: number; customers: number; batches: number };
}
```

### 1.2 `GET /api/catalogue/snapshot`
Full catalogue as NDJSON, gzipped, for first-run hydration. Streams so the client can index progressively.

```
Accept-Encoding: gzip
→ 200, Content-Type: application/x-ndjson
{"_t":"product","id":"abc","sku":"SUG-1",...}
{"_t":"unit_conversion","product_id":"abc","unit_code":"KG","factor_to_base":"1000"}
{"_t":"batch","id":"b1","product_id":"abc","current_stock_base":"45000",...}
{"_t":"customer","id":"c1","name":"Sharma-ji",...}
{"_t":"_end","cursors":{...},"count":21430}
```

### 1.3 `GET /api/products/lookup?barcode={code}`
Online fallback when a scanned barcode misses the local cache.

```ts
interface ProductLookupResponse {
  product: ProductDTO;
  unit_conversions: UnitConversionDTO[];
  matched_unit: UnitCode;             // the unit this barcode represents
  available_batches: BatchLite[];     // FEFO-ordered, top 5
}

interface ProductDTO {
  id: DocumentId; sku: string; name: string; name_local?: string;
  category_id?: DocumentId; hsn_code?: string;
  base_unit: BaseUnit; allow_fractional: boolean; quantity_precision: 0|1|2|3;
  default_sale_unit: UnitCode; pricing_unit: UnitCode;
  requires_quantity_prompt: boolean;
  mrp_paise?: Paise; sell_rate_paise: Paise;
  gst_rate: number; cess_rate: number; tax_inclusive: boolean;
  discount_exempt: boolean; track_batches: boolean; track_expiry: boolean;
  image_url?: string; sales_rank: number; is_active: boolean;
  updated_at: ISODateTime;
}

interface UnitConversionDTO {
  id: DocumentId; product_id: DocumentId; unit_code: UnitCode;
  factor_to_base: DecimalString; is_sale_unit: boolean; is_purchase_unit: boolean;
  price_override_paise?: Paise; label_local?: string; barcode?: string;
}

interface BatchLite {
  id: DocumentId; batch_no: string; expiry_date?: ISODate;
  current_stock_base: DecimalString; mrp_paise?: Paise; selling_price_paise?: Paise;
}
```

---

## 2. Fast Checkout — `POST /api/pos/checkout`

**Strapi:** `POST /api/checkout` → `checkout.service.createOrder()`
**Headers:** `Idempotency-Key`, `X-Device-Id` required.
**The single most important contract in the system.** One call performs: validation → FEFO allocation → stock decrement → movements → order/items/payments insert → ledger post (if credit) → invoice number → shift aggregates → audit — in one transaction.

### 2.1 Request

```ts
interface CreateOrderRequest {
  client_uuid: UUID;                 // == Idempotency-Key, generated at cart creation
  counter_id?: DocumentId;
  shift_id?: DocumentId;             // required when store.config.shift.enabled
  customer_id?: DocumentId;          // required if any payment.method === 'CREDIT'
  order_type: 'SALE' | 'RETURN';
  original_order_id?: DocumentId;    // required when order_type === 'RETURN'

  items: CreateOrderItem[];
  cart_discount?: { type: 'FLAT' | 'PCT'; value: number };   // FLAT = paise, PCT = e.g. 5 for 5%
  charges?: Array<{ code: string; label: string; amount_paise: Paise;
                    gst_rate?: number; hsn_code?: string }>;
  payments: CreateOrderPayment[];

  // client-computed totals, sent for verification (server recomputes authoritatively)
  client_totals?: InvoiceTotals;

  provisional_no?: string;           // offline bills only
  client_created_at: ISODateTime;
  is_offline_origin: boolean;
  note?: string;
  approval_tokens?: string[];        // for overrides used while building the cart
}

interface CreateOrderItem {
  line_group_id: UUID;               // client-generated; groups multi-batch splits
  product_id: DocumentId;
  entered_qty: DecimalString;        // "0.250"
  entered_unit: UnitCode;            // "KG"
  // qty_base is derived server-side; client may send it for verification only
  qty_base?: DecimalString;          // "250.0000"
  batch_id?: DocumentId;             // pin a batch (skips FEFO); requires permission if manual
  unit_price_paise?: Paise;          // only when price_source === 'MANUAL'
  price_source?: 'PRODUCT' | 'BATCH' | 'UNIT_OVERRIDE' | 'MANUAL';
  line_discount?: { type: 'FLAT' | 'PCT'; value: number };
  note?: string;
}

interface CreateOrderPayment {
  method: PaymentMethod;
  amount_paise: Paise;
  tendered_paise?: Paise;            // CASH only
  reference?: string;                // card last4 / UPI txn id / cheque no
  provider?: string;
}
```

### 2.2 Response `201`

```ts
interface CreateOrderResponse {
  order: {
    id: DocumentId;
    invoice_no: string;              // "INV/2026-27/C3/000391"
    provisional_no?: string;
    financial_year: string;
    business_date: ISODate;
    server_created_at: ISODateTime;
    status: 'COMPLETED';
    settlement_status: 'SETTLED' | 'PARTIALLY_SETTLED' | 'UNPAID';
    supply_type: SupplyType;
  };
  totals: InvoiceTotals;
  items: OrderItemResult[];
  payments: Array<{ method: PaymentMethod; amount_paise: Paise; change_paise?: Paise }>;
  customer?: { id: DocumentId; name: string;
               balance_before_paise: Paise; balance_after_paise: Paise;
               credit_headroom_paise: Paise | null };
  warnings?: Array<{ code: string; message: string; item_index?: number }>;
  print_payload: PrintPayload;       // ready-to-render receipt model
}

interface InvoiceTotals {
  gross_paise: Paise;
  line_discount_paise: Paise;
  cart_discount_paise: Paise;
  taxable_value_paise: Paise;
  cgst_paise: Paise; sgst_paise: Paise; igst_paise: Paise; cess_paise: Paise;
  charges_paise: Paise;
  round_off_paise: Paise;            // signed
  total_paise: Paise;
  paid_paise: Paise;
  credit_paise: Paise;
  tax_breakup: Array<{ gst_rate: number; taxable_paise: Paise;
                       cgst_paise: Paise; sgst_paise: Paise; igst_paise: Paise }>;
  item_count: number;
  total_qty_display: string;         // "3 items · 1.75 kg"
}

interface OrderItemResult {
  line_group_id: UUID;
  line_no: number;
  product_id: DocumentId; product_name: string; product_name_local?: string;
  batch_id?: DocumentId; batch_no?: string; expiry_date?: ISODate;
  entered_qty: DecimalString; entered_unit: UnitCode;
  qty_base: DecimalString; base_unit: BaseUnit;
  unit_price_paise: Paise; price_source: string;
  gross_paise: Paise; line_discount_paise: Paise; cart_discount_share_paise: Paise;
  taxable_value_paise: Paise; gst_rate: number;
  cgst_paise: Paise; sgst_paise: Paise; igst_paise: Paise;
  line_total_paise: Paise;
  stock_after_base: DecimalString;   // batch stock after decrement
  was_oversold: boolean;
}
```

### 2.3 Error responses

```jsonc
// 422 — insufficient stock
{
  "error": {
    "code": "ERR_INSUFFICIENT_STOCK",
    "message": "Insufficient stock for product SUG-1",
    "message_localized": { "hi": "चीनी का स्टॉक कम है", "en": "Not enough Sugar in stock" },
    "field": "items[0]",
    "details": { "product_id": "abc", "requested_base": "2000.0000",
                 "available_base": "1200.0000", "shortfall_base": "800.0000" },
    "resolutions": [
      { "action": "REDUCE_QTY", "label": "Sell 1.2 kg instead",
        "payload_patch": { "items[0].entered_qty": "1.200" } },
      { "action": "POST_AS_NEGATIVE", "label": "Post anyway and adjust",
        "requires_permission": "inventory.adjust" },
      { "action": "VOID", "label": "Cancel this bill" }
    ],
    "trace_id": "01JB..."
  }
}
```

```jsonc
// 422 — credit limit
{
  "error": {
    "code": "ERR_CREDIT_LIMIT_BREACH",
    "message": "Credit limit exceeded",
    "details": { "customer_id": "c1", "limit_paise": 200000,
                 "balance_paise": 190000, "requested_credit_paise": 25400,
                 "overshoot_paise": 15400, "enforcement_mode": "ALLOW_WITH_APPROVAL" },
    "resolutions": [
      { "action": "APPROVE_OVERRIDE", "label": "Supervisor approval",
        "requires_permission": "credit.exceed_limit" },
      { "action": "CONVERT_TO_CASH", "label": "Take cash instead" }
    ],
    "trace_id": "01JB..."
  }
}
```

```jsonc
// 409 — transient lock contention; client retries once after 150–400 ms jitter
{ "error": { "code": "ERR_BUSY_RETRY", "message": "Row lock timeout, retry", "trace_id": "01JB..." } }
```

### 2.4 Server-side processing contract (normative)

1. Verify idempotency key → replay if `COMPLETED`, `409` if `IN_PROGRESS`.
2. Validate DTO (Zod) → `400` on schema failure.
3. Resolve store context, assert every referenced id belongs to the store → `403` otherwise.
4. Resolve products + unit conversions; compute `qty_base` server-side. If the client sent `qty_base` and it differs, log a `TOTALS_MISMATCH` telemetry event and use the server value.
5. Build the batch lock set (FEFO plan for each item), sort ascending by id, `SELECT … FOR UPDATE`.
6. Recompute all totals using the shared pricing module. If `client_totals` differs by > 0 paise, emit telemetry; server value wins.
7. Guarded decrement per batch; on 0 rows, re-plan (max 2 retries) then `422`.
8. Insert `stock_movements` (`SALE`, negative `qty_base`).
9. Allocate invoice number from `invoice_sequences` `FOR UPDATE`.
10. Insert `orders`, `order_items`, `order_payments`.
11. If credit: lock customer, post `customer_ledger_entries` (`SALE_CREDIT`, DEBIT), update cached balance.
12. Update shift aggregates.
13. Insert `audit_logs` rows for any override used.
14. Mark idempotency key `COMPLETED` with the serialized response.
15. `COMMIT`. Post-commit (outside txn): emit domain events, build `print_payload`, warm caches.

### 2.5 `PrintPayload`

```ts
interface PrintPayload {
  template: 'RECEIPT_58' | 'RECEIPT_80' | 'A5_INVOICE';
  language: 'hi' | 'en';
  render_mode: 'TEXT' | 'RASTER';
  copies: number;
  mark_provisional: boolean;
  header: { store_name: string; address_lines: string[]; phone?: string;
            gstin?: string; logo_url?: string };
  meta: { invoice_no: string; date_display: string; time_display: string;
          cashier: string; counter?: string;
          customer?: { name: string; phone_masked?: string } };
  lines: Array<{ name: string; qty_display: string; rate_display: string;
                 amount_display: string; batch_display?: string; note?: string }>;
  totals_block: Array<{ label: string; value: string; emphasis?: boolean }>;
  tax_block?: Array<{ rate: string; taxable: string; cgst: string; sgst: string }>;
  payments_block: Array<{ label: string; value: string }>;
  credit_block?: { previous_balance: string; this_bill: string; new_balance: string };
  footer_lines: string[];
  qr?: { type: 'UPI' | 'INVOICE_LINK'; data: string };
  open_drawer: boolean;
}
```

---

## 3. Offline Sync

### 3.1 `POST /api/sync/push`

**Strapi:** `POST /api/sync/push` → `sync.service.push()`
Batch of buffered client operations. Max 25 items. Each item is independently idempotent.

```ts
interface SyncPushRequest {
  device_id: string;
  app_version: string;
  client_time: ISODateTime;
  items: SyncItem[];
}

type SyncItem =
  | { kind: 'ORDER';        seq: number; client_uuid: UUID; payload: CreateOrderRequest }
  | { kind: 'SETTLEMENT';   seq: number; client_uuid: UUID; depends_on?: UUID; payload: SettlementRequest }
  | { kind: 'ADJUSTMENT';   seq: number; client_uuid: UUID; payload: StockAdjustmentRequest }
  | { kind: 'CUSTOMER_NEW'; seq: number; client_uuid: UUID; payload: QuickCustomerRequest }
  | { kind: 'CASH_MOVEMENT';seq: number; client_uuid: UUID; payload: CashMovementRequest };

interface SyncPushResponse {
  server_time: ISODateTime;
  results: SyncItemResult[];
  pull_hint?: { stale_collections: Array<'products'|'batches'|'customers'|'config'> };
  device_directive?: { force_update: boolean; min_app_version?: string; message?: string };
}

type SyncItemResult =
  | { client_uuid: UUID; seq: number; status: 'APPLIED';
      server_id: DocumentId; invoice_no?: string; receipt_no?: string;
      totals?: InvoiceTotals; allocations?: OrderItemResult[];
      customer_balance_after_paise?: Paise; print_payload?: PrintPayload }
  | { client_uuid: UUID; seq: number; status: 'REPLAYED';
      server_id: DocumentId; invoice_no?: string }
  | { client_uuid: UUID; seq: number; status: 'DEFERRED';
      reason: 'DEPENDENCY_PENDING'; depends_on: UUID }
  | { client_uuid: UUID; seq: number; status: 'REJECTED';
      error: ApiError['error']; exception_id: DocumentId };
```

**Semantics**
- Items are processed in ascending `seq`. Each item runs in its **own** transaction — a rejection never rolls back a sibling.
- `REJECTED` items are persisted to `sync_exceptions` server-side **and** returned to the client, so the exception queue exists on both sides.
- `DEFERRED` items are not persisted; the client retries them in the next batch once the dependency reports `APPLIED`/`REPLAYED`.
- HTTP status is `200` when any item was processed, even if some were rejected. A whole-batch failure (auth, device unknown, malformed envelope) returns `4xx` and the client retries the whole batch.

**Example exchange**

```jsonc
// Request
{
  "device_id": "d-7f3a...",
  "app_version": "1.4.2",
  "client_time": "2026-09-21T14:02:11.000Z",
  "items": [
    { "kind": "ORDER", "seq": 141, "client_uuid": "9a1f...", "payload": { /* CreateOrderRequest */ } },
    { "kind": "ORDER", "seq": 142, "client_uuid": "b2c8...", "payload": { /* ... */ } },
    { "kind": "SETTLEMENT", "seq": 143, "client_uuid": "cc10...", "depends_on": "b2c8...",
      "payload": { /* SettlementRequest */ } }
  ]
}

// Response
{
  "server_time": "2026-09-21T14:02:12.410Z",
  "results": [
    { "client_uuid": "9a1f...", "seq": 141, "status": "APPLIED",
      "server_id": "ord_01J...", "invoice_no": "INV/2026-27/K1/000391",
      "totals": { "total_paise": 25400, "...": "..." },
      "customer_balance_after_paise": 149400 },
    { "client_uuid": "b2c8...", "seq": 142, "status": "REJECTED",
      "exception_id": "exc_01J...",
      "error": { "code": "ERR_INSUFFICIENT_STOCK",
                 "message": "Insufficient stock for SUG-1",
                 "details": { "available_base": "0.0000", "requested_base": "500.0000" },
                 "resolutions": [ { "action": "POST_AS_NEGATIVE", "label": "Post and adjust" },
                                  { "action": "VOID", "label": "Cancel bill" } ],
                 "trace_id": "01JB..." } },
    { "client_uuid": "cc10...", "seq": 143, "status": "DEFERRED",
      "reason": "DEPENDENCY_PENDING", "depends_on": "b2c8..." }
  ],
  "pull_hint": { "stale_collections": ["batches"] }
}
```

### 3.2 `GET /api/sync/pull`

```
GET /api/sync/pull?products={cursor}&batches={cursor}&customers={cursor}&config={cursor}&limit=500
```

```ts
interface SyncCursors {
  products: string; batches: string; customers: string; config: string;
  // cursor format: base64("{updated_at_iso}|{id}")
}

interface SyncPullResponse {
  server_time: ISODateTime;
  cursors: SyncCursors;              // next cursors
  has_more: boolean;                 // page again immediately if true
  full_resync_required?: boolean;    // cursor older than 30-day retention
  products:    { upserts: ProductDTO[];          deletes: DocumentId[] };
  conversions: { upserts: UnitConversionDTO[];   deletes: DocumentId[] };
  barcodes:    { upserts: BarcodeDTO[];          deletes: DocumentId[] };
  batches:     { upserts: BatchStockDTO[];       deletes: DocumentId[] };
  customers:   { upserts: CustomerDTO[];         deletes: DocumentId[] };
  config?: StoreConfig;
}

interface BatchStockDTO {
  id: DocumentId; product_id: DocumentId; batch_no: string;
  expiry_date?: ISODate; current_stock_base: DecimalString;
  mrp_paise?: Paise; selling_price_paise?: Paise; status: string;
  updated_at: ISODateTime;
}

interface CustomerDTO {
  id: DocumentId; name: string; name_local?: string;
  phone_last4?: string; phone_masked?: string;     // full phone only on detail fetch
  credit_limit_enabled: boolean; credit_limit_paise: Paise; credit_days: number;
  current_balance_paise: Paise; is_active: boolean; updated_at: ISODateTime;
}
```

### 3.3 `POST /api/sync/exceptions/{id}/resolve`

```ts
interface ResolveExceptionRequest {
  action: ResolutionAction['action'];
  approval_token?: string;
  patched_payload?: Record<string, unknown>;   // for REDUCE_QTY / REALLOCATE_BATCH / SUBSTITUTE
  reason_code?: string;
  reason_text?: string;                        // mandatory for VOID
}

interface ResolveExceptionResponse {
  exception_id: DocumentId;
  status: 'RESOLVED' | 'VOIDED';
  result?: CreateOrderResponse | SettlementResponse;   // when the retry succeeded
}
```

### 3.4 `GET /api/sync/status`

```ts
interface SyncStatusResponse {
  device_id: string;
  last_push_at?: ISODateTime;
  last_pull_at?: ISODateTime;
  open_exceptions: number;
  server_time: ISODateTime;
  catalogue_version: string;         // changes when a full resync is advisable
}
```

---

## 4. Stock Inwarding & Batch Creation

### 4.1 `POST /api/inventory/grn`

**Strapi:** `POST /api/purchase-bills/receive` → `inventory.service.receiveGRN()`
Creates/updates batches, posts `PURCHASE_IN` movements, credits the supplier ledger — one transaction.

```ts
interface CreateGRNRequest {
  client_uuid: UUID;
  supplier_id: DocumentId;
  purchase_order_id?: DocumentId;
  supplier_invoice_no?: string;
  supplier_invoice_date?: ISODate;
  received_at?: ISODateTime;
  due_date?: ISODate;

  items: GRNItem[];
  bill_discount_paise?: Paise;
  freight_paise?: Paise;
  other_charges_paise?: Paise;
  freight_apportionment?: 'BY_VALUE' | 'BY_QTY' | 'NONE';   // default BY_VALUE
  round_off_paise?: Paise;

  payment?: { method: PaymentMethod; amount_paise: Paise; reference?: string };
  approval_token?: string;          // when rate/qty variance exceeds tolerance
  note?: string;
}

interface GRNItem {
  product_id: DocumentId;
  received_qty: DecimalString;      // in received_unit, e.g. "2" cartons
  received_unit: UnitCode;          // "CARTON"
  free_qty?: DecimalString;         // scheme goods, same unit
  batch_no?: string;                // omit → 'DEFAULT' when batch tracking is off
  mfg_date?: ISODate;
  expiry_date?: ISODate;
  cost_rate_paise: Paise;           // per received_unit, EXCLUSIVE of tax
  discount_paise?: Paise;
  gst_rate?: number;                // defaults to product.gst_rate
  mrp_paise?: Paise;
  selling_price_paise?: Paise;      // per product.pricing_unit
  update_product_sell_rate?: boolean;   // push selling price to the product master
}
```

**Response `201`**

```ts
interface CreateGRNResponse {
  purchase_bill: {
    id: DocumentId; grn_no: string; status: 'POSTED' | 'PENDING_APPROVAL';
    subtotal_paise: Paise; tax_paise: Paise; freight_paise: Paise;
    round_off_paise: Paise; total_paise: Paise;
    paid_paise: Paise; payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
    business_date: ISODate;
  };
  batches: Array<{
    batch_id: DocumentId; product_id: DocumentId; batch_no: string;
    expiry_date?: ISODate;
    qty_in_base: DecimalString;
    stock_after_base: DecimalString;
    cost_per_base_paise: Paise;
    landed_cost_per_base_paise: Paise;
    was_existing_batch: boolean;          // true = topped up, weighted-avg cost recomputed
    previous_cost_per_base_paise?: Paise;
  }>;
  supplier: { id: DocumentId; balance_before_paise: Paise; balance_after_paise: Paise };
  warnings?: Array<{ code: string; message: string; item_index?: number }>;
  // e.g. WARN_RATE_VARIANCE, WARN_EXPIRY_SHORT, WARN_MRP_REDUCED, WARN_SELLING_BELOW_COST
}
```

**Rejections:** `ERR_EXPIRY_BEFORE_MFG`, `ERR_EXPIRY_IN_PAST`, `ERR_UNIT_NOT_PURCHASABLE`, `ERR_RATE_VARIANCE_EXCEEDS_TOLERANCE` (→ `APPROVE_OVERRIDE`), `ERR_PO_OVER_RECEIPT`, `ERR_SELLING_BELOW_COST` (warning by default, blocking if `purchase.block_below_cost`).

### 4.2 `POST /api/inventory/batches` (direct batch / opening stock)

```ts
interface CreateBatchRequest {
  client_uuid: UUID;
  product_id: DocumentId;
  batch_no: string;
  mfg_date?: ISODate; expiry_date?: ISODate;
  opening_qty: DecimalString; opening_unit: UnitCode;
  cost_price_paise: Paise;      // per opening_unit
  mrp_paise?: Paise; selling_price_paise?: Paise;
  movement_type: 'OPENING' | 'ADJUSTMENT_IN';
  reason_code?: string;
}
```

### 4.3 `POST /api/inventory/adjustments`

```ts
interface StockAdjustmentRequest {
  client_uuid: UUID;
  kind: 'DAMAGE' | 'THEFT' | 'SAMPLING' | 'CORRECTION' | 'STOCKTAKE' | 'EXPIRY';
  reason_text?: string;
  approval_token?: string;              // required above store threshold
  items: Array<{
    product_id: DocumentId;
    batch_id?: DocumentId;              // omit → FEFO for OUT, DEFAULT batch for IN
    direction: 'IN' | 'OUT';
    qty: DecimalString; unit: UnitCode;
    reason_code?: string;
    counted_qty?: DecimalString;        // STOCKTAKE: system computes the delta
  }>;
}

interface StockAdjustmentResponse {
  adjustment: { id: DocumentId; adjustment_no: string;
                status: 'POSTED' | 'PENDING_APPROVAL'; total_value_paise: Paise };
  movements: Array<{ batch_id: DocumentId; qty_base: DecimalString;
                     stock_after_base: DecimalString; value_paise: Paise }>;
}
```

### 4.4 `POST /api/purchase/payments`

```ts
interface SupplierPaymentRequest {
  client_uuid: UUID;
  supplier_id: DocumentId;
  amount_paise: Paise;
  method: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';
  reference?: string;
  shift_id?: DocumentId;                   // CASH during an open shift → affects drawer
  allocations?: Array<{ purchase_bill_id: DocumentId; amount_paise: Paise }>;  // omit → FIFO
}

interface SupplierPaymentResponse {
  payment: { id: DocumentId; amount_paise: Paise; unallocated_paise: Paise };
  supplier: { id: DocumentId; balance_before_paise: Paise; balance_after_paise: Paise };
  allocations: Array<{ purchase_bill_id: DocumentId; grn_no: string;
                       amount_paise: Paise; bill_status: string }>;
}
```

---

## 5. Customer Khata & Settlement

### 5.1 `GET /api/customers/search?q={query}&limit=10`

```ts
interface CustomerSearchResponse {
  results: Array<{
    id: DocumentId; name: string; name_local?: string; phone_masked?: string;
    current_balance_paise: Paise;
    credit_limit_enabled: boolean; credit_limit_paise: Paise;
    headroom_paise: Paise | null;        // null when no limit
    has_overdue: boolean; last_txn_at?: ISODateTime;
  }>;
}
```

### 5.2 `POST /api/customers/quick`

```ts
interface QuickCustomerRequest {
  client_uuid: UUID;
  name: string;
  phone: string;                         // E.164 or 10-digit; normalised server-side
  credit_limit_paise?: Paise;
  credit_days?: number;
  opening_balance_paise?: Paise;
}
interface QuickCustomerResponse {
  customer: CustomerDTO;
  was_existing: boolean;                 // matched on phone → returns the existing record
}
```

### 5.3 `POST /api/customers/{id}/settle`

**Strapi:** `POST /api/customer-payments` → `ledger.service.settle()`

```ts
interface SettlementRequest {
  client_uuid: UUID;
  customer_id: DocumentId;
  amount_paise: Paise;                   // > 0
  method: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';
  reference?: string;
  shift_id?: DocumentId;                 // CASH → increments expected drawer cash
  received_at?: ISODateTime;
  allocations?: Array<{ order_id: DocumentId; amount_paise: Paise }>;  // omit → auto-FIFO
  note?: string;
}

interface SettlementResponse {
  payment: {
    id: DocumentId; receipt_no: string; amount_paise: Paise;
    method: PaymentMethod; unallocated_paise: Paise; received_at: ISODateTime;
  };
  customer: {
    id: DocumentId; name: string;
    balance_before_paise: Paise; balance_after_paise: Paise;
    headroom_paise: Paise | null;
    is_advance: boolean;                 // true when balance_after < 0
  };
  allocations: Array<{
    order_id: DocumentId; invoice_no: string; invoice_date: ISODate;
    invoice_total_paise: Paise;
    previously_allocated_paise: Paise; allocated_now_paise: Paise;
    settlement_status: 'SETTLED' | 'PARTIALLY_SETTLED' | 'UNPAID';
  }>;
  ledger_entry: { id: DocumentId; direction: 'CREDIT';
                  amount_paise: Paise; running_balance_paise: Paise };
  print_payload: PrintPayload;
  whatsapp_payload?: { url: string; text: string };
}
```

**Rejections:** `ERR_AMOUNT_INVALID` (≤ 0), `ERR_ALLOCATION_EXCEEDS_PAYMENT`, `ERR_ALLOCATION_EXCEEDS_INVOICE`, `ERR_ORDER_NOT_CUSTOMER` (allocating to another customer's invoice), `ERR_NO_OPEN_SHIFT` (cash settlement when shifts are mandatory).

### 5.4 `GET /api/customers/{id}/ledger?from={date}&to={date}&page=1&page_size=50`

```ts
interface CustomerLedgerResponse {
  customer: { id: DocumentId; name: string; phone_masked?: string;
              credit_limit_paise: Paise; credit_days: number };
  opening_balance_paise: Paise;
  closing_balance_paise: Paise;
  totals: { debit_paise: Paise; credit_paise: Paise };
  ageing: { bucket_0_30: Paise; bucket_31_60: Paise;
            bucket_61_90: Paise; bucket_90_plus: Paise };
  entries: Array<{
    id: DocumentId; entry_date: ISODate; entry_type: string;
    direction: 'DEBIT' | 'CREDIT'; amount_paise: Paise;
    running_balance_paise: Paise;
    reference_label?: string;            // "INV/2026-27/K1/000391" or "RCP-0042"
    reference_id?: DocumentId; note?: string;
  }>;
  pagination: { page: number; page_size: number; total: number };
}
```

### 5.5 `POST /api/customers/{id}/whatsapp-payload`

```ts
interface WhatsAppPayloadRequest {
  kind: 'RECEIPT' | 'STATEMENT' | 'REMINDER';
  order_id?: DocumentId;
  payment_id?: DocumentId;
  from?: ISODate; to?: ISODate;
  language?: 'hi' | 'en';
}
interface WhatsAppPayloadResponse { url: string; text: string; phone_e164: string; }
```

---

## 6. Shift Management

### 6.1 `POST /api/shifts/open`
```ts
interface OpenShiftRequest {
  client_uuid: UUID; counter_id: DocumentId;
  opening_float_paise: Paise; device_id: string;
}
interface ShiftSummary {
  id: DocumentId; counter: { id: DocumentId; code: string; name: string };
  user: { id: DocumentId; full_name: string };
  status: 'OPEN' | 'PENDING_COUNT' | 'CLOSED' | 'UNDER_REVIEW';
  opened_at: ISODateTime; closed_at?: ISODateTime;
  opening_float_paise: Paise;
  bill_count: number;
  tender_totals: Record<PaymentMethod, Paise>;
}
```
**Rejections:** `ERR_SHIFT_ALREADY_OPEN_COUNTER`, `ERR_SHIFT_ALREADY_OPEN_USER`.

### 6.2 `GET /api/shifts/{id}/expected`
```ts
interface ExpectedCashResponse {
  shift_id: DocumentId;
  opening_float_paise: Paise;
  cash_sales_paise: Paise;
  cash_collections_paise: Paise;
  cash_in_paise: Paise;
  cash_out_paise: Paise;
  cash_refunds_paise: Paise;
  expected_cash_paise: Paise;
  non_cash: { card_paise: Paise; upi_paise: Paise;
              wallet_paise: Paise; credit_paise: Paise };
  blockers: Array<{ code: 'UNSYNCED_BILLS' | 'PARKED_CARTS' | 'OPEN_EXCEPTIONS';
                    count: number; message: string }>;
}
```

### 6.3 `POST /api/shifts/{id}/close`
```ts
interface CloseShiftRequest {
  denomination_count: {
    d2000?: number; d500?: number; d200?: number; d100?: number; d50?: number;
    d20?: number; d10?: number; d5?: number; d2?: number; d1?: number;
    coins_paise?: number;
  };
  variance_reason_code?: 'MISCOUNT' | 'CHANGE_ERROR' | 'UNRECORDED_PAYOUT'
                       | 'THEFT_SUSPECTED' | 'OTHER';
  variance_reason_text?: string;
  approval_token?: string;              // required when |variance| > tolerance
}

interface CloseShiftResponse {
  shift: ShiftSummary;
  expected_cash_paise: Paise;
  actual_cash_paise: Paise;
  variance_paise: Paise;                // negative = shortage
  variance_classification: 'NONE' | 'WITHIN_TOLERANCE' | 'REQUIRES_REASON' | 'ESCALATED';
  z_report: ZReport;
  print_payload: PrintPayload;
}

interface ZReport {
  shift_id: DocumentId; store_name: string; counter_code: string; cashier_name: string;
  opened_at: ISODateTime; closed_at: ISODateTime;
  tender_totals: Record<PaymentMethod, Paise>;
  bill_count: number; avg_bill_paise: Paise; items_sold: DecimalString;
  discount_count: number; discount_total_paise: Paise;
  void_count: number; void_total_paise: Paise;
  return_count: number; return_total_paise: Paise;
  cash_movements: Array<{ direction: 'IN' | 'OUT'; reason_code: string; amount_paise: Paise }>;
  tax_breakup: Array<{ gst_rate: number; taxable_paise: Paise; tax_paise: Paise }>;
  top_products: Array<{ product_name: string; qty_display: string; value_paise: Paise }>;
  expected_cash_paise: Paise; actual_cash_paise: Paise; variance_paise: Paise;
}
```

### 6.4 `POST /api/shifts/{id}/cash-movement`
```ts
interface CashMovementRequest {
  client_uuid: UUID;
  direction: 'IN' | 'OUT';
  amount_paise: Paise;
  reason_code: 'FLOAT_TOPUP' | 'BANK_DROP' | 'PETTY_EXPENSE' | 'SUPPLIER_PAYMENT' | 'REFUND' | 'OTHER';
  note?: string;
  approval_token?: string;
}
```

### 6.5 `POST /api/shifts/{id}/force-close`
```ts
interface ForceCloseRequest { approval_token: string; reason_text: string; }
```

---

## 7. Orders — Read, Return, Reprint

### 7.1 `GET /api/orders?from&to&customer_id&shift_id&counter_id&q&page&page_size`
Returns `OrderListItem[]` with `{ id, invoice_no, business_date, customer_name?, total_paise, settlement_status, status, is_offline_origin }` plus pagination meta.

### 7.2 `GET /api/orders/{id}` → `CreateOrderResponse`-shaped detail (items, payments, allocations, audit summary).

### 7.3 `POST /api/orders/{id}/return`
```ts
interface CreateReturnRequest {
  client_uuid: UUID;
  shift_id?: DocumentId;
  items: Array<{ order_item_id: DocumentId; return_qty: DecimalString; unit: UnitCode;
                 restock: boolean; reason_code: string }>;
  refund: { method: PaymentMethod; amount_paise: Paise };  // CREDIT → credit note to ledger
  approval_token?: string;
  reason_text?: string;
}
interface CreateReturnResponse {
  return_order: { id: DocumentId; invoice_no: string; total_paise: Paise };
  original_order: { id: DocumentId; status: 'PARTIALLY_RETURNED' | 'RETURNED' };
  restocked: Array<{ batch_id: DocumentId; qty_base: DecimalString;
                     stock_after_base: DecimalString }>;
  ledger_entry?: { id: DocumentId; amount_paise: Paise; running_balance_paise: Paise };
  print_payload: PrintPayload;
}
```
**Rule:** returned quantity per line may never exceed `order_item.qty_base − returned_qty_base`; restocking goes back to the **original batch** (traceability), never FEFO.

### 7.4 `POST /api/orders/{id}/reprint`
```ts
interface ReprintRequest { copies?: number; reason?: string; }
interface ReprintResponse { print_payload: PrintPayload; print_count: number; }
```
Always audited; the payload sets `mark_duplicate = true` in `footer_lines`.

---

## 8. Reports (selected contracts)

### 8.1 `GET /api/reports/day-book?date={ISODate}`
```ts
interface DayBookResponse {
  business_date: ISODate;
  opening_cash_paise: Paise; closing_cash_paise: Paise;
  sales: { bill_count: number; gross_paise: Paise; discount_paise: Paise;
           tax_paise: Paise; net_paise: Paise };
  tender_totals: Record<PaymentMethod, Paise>;
  collections_paise: Paise; payouts_paise: Paise;
  returns: { count: number; value_paise: Paise };
  credit_issued_paise: Paise;
  by_counter: Array<{ counter_code: string; bill_count: number; net_paise: Paise }>;
  by_shift: Array<{ shift_id: DocumentId; cashier: string; variance_paise: Paise }>;
}
```

### 8.2 `GET /api/reports/outstanding?type=RECEIVABLE|PAYABLE`
```ts
interface OutstandingResponse {
  total_paise: Paise;
  ageing: { bucket_0_30: Paise; bucket_31_60: Paise; bucket_61_90: Paise; bucket_90_plus: Paise };
  rows: Array<{ party_id: DocumentId; party_name: string; phone_masked?: string;
                balance_paise: Paise; oldest_invoice_date?: ISODate;
                days_overdue: number; is_over_limit: boolean }>;
}
```

### 8.3 `GET /api/reports/expiry-risk?days=30`
```ts
interface ExpiryRiskResponse {
  as_of: ISODate;
  total_value_at_risk_paise: Paise;
  buckets: Array<{ bucket: 'EXPIRED' | 'D7' | 'D15' | 'D30';
                   batch_count: number; value_paise: Paise }>;
  rows: Array<{ batch_id: DocumentId; product_name: string; batch_no: string;
                expiry_date: ISODate; days_to_expiry: number;
                stock_base: DecimalString; stock_display: string;
                value_at_cost_paise: Paise }>;
}
```

---

## 9. Auth

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | `{ email, password }` → session cookie + `BootstrapResponse` subset |
| `POST /api/auth/pin` | `{ store_code, user_id, pin, device_id }` → POS session |
| `POST /api/auth/approval` | `{ pin, action, entity_type, entity_id?, permission }` → `{ approval_token, expires_at }` |
| `POST /api/auth/refresh` | Slides the session |
| `POST /api/auth/logout` | Invalidates the session; blocked if the device has unsynced bills (warns, allows with confirm) |
| `POST /api/devices/register` | `{ store_code, registration_code, device_uid, label }` → `{ device_id, secret }` |

---

## 10. Versioning & Compatibility

- Contract version travels in `X-App-Version`; the server supports the **current and previous two minor versions** of the sync contract.
- Additive changes (new optional fields) are non-breaking and ship freely.
- Breaking changes require a new path segment (`/api/v2/pos/checkout`) and a deprecation window of **90 days**, because field devices hold unsynced bills for a long time.
- `device_directive.force_update` in a sync response triggers a guided flow: **push everything first**, then update. The client must never update with a non-empty outbox.
- `GET /api/health` → `{ status, server_time, contract_version }`, used for connectivity probing (must be cheap, unauthenticated, and never hit the database).

---

## 11. Rate Limits

| Route class | Limit |
|---|---|
| `POST /api/auth/*` | 10 / min / IP, 5 / min / user (lockout after 5 PIN failures) |
| `POST /api/pos/checkout` | 120 / min / device |
| `POST /api/sync/push` | 30 / min / device |
| `GET /api/sync/pull` | 20 / min / device |
| `GET /api/products/lookup` | 300 / min / device |
| `GET /api/reports/*` | 30 / min / user |

Exceeding returns `429` with `Retry-After`. The sync worker honours `Retry-After` exactly and does not fall back to a fixed interval.
