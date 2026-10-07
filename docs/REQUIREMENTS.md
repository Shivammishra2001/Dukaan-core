# REQUIREMENTS.md — Functional & Technical Specifications

**System:** DUKAAN Core — Unified POS & Smart Inventory
**Audience:** Implementing engineers, QA, and reviewers. Every rule here is testable.
**Convention:** MUST / SHOULD / MAY per RFC 2119. All examples use ₹ with paise integers.

---

## 0. Foundational Data Rules (apply everywhere)

### 0.1 Money
- **Storage:** integer **paise**. `BIGINT` in PostgreSQL, `number` (safe integer) in TypeScript. ₹125.50 → `12550`.
- **Never** store money as `float`, `double`, or a decimal string that gets parsed by `parseFloat`.
- **Display:** divide by 100 at the render boundary only, with `Intl.NumberFormat('en-IN', { style:'currency', currency:'INR' })`.
- **Intermediate math** that produces fractions of a paise MUST use `decimal.js` (or PostgreSQL `NUMERIC`) and round exactly once, at the point specified by the rule.
- **Rounding rule (default):** half-up away from zero (`ROUND_HALF_UP`), configurable per store as `tax.rounding_mode`.

### 0.2 Quantity
- Every product has exactly one **base unit** ∈ {`G`, `ML`, `PCS`}. (`KG`, `L`, `PACKET`, `CARTON`, `BORI`, `DOZEN` are *derived* units, never base units.)
- **Storage:** `NUMERIC(18,4)` base units. 250 g → `250.0000`. 1.5 kg → `1500.0000`. 2 pcs → `2.0000`.
- All stock, all order lines, all movements are stored **in base units**. The unit the user chose is stored alongside for display/printing (`entered_qty`, `entered_unit`), but is never the source of truth for arithmetic.
- `PCS`-based products MUST have `allow_fractional = false` unless explicitly overridden (e.g. "half a watermelon" → allow fractional pcs with 0.5 precision).

### 0.3 Identity & Time
- Primary keys: `BIGSERIAL` internal `id` + Strapi v5 `documentId` (string) for API surface + `client_uuid` (UUIDv4/ULID) where client-originated.
- All timestamps stored `TIMESTAMPTZ` in UTC. Business day boundary is store-configurable (`store.day_start_time`, default `00:00` IST) — the day book groups on business day, not UTC day.
- `client_created_at` and `server_created_at` are both persisted for offline records; **accounting period assignment uses `server_created_at`** unless the store enables `sync.honour_client_date` (then client date is used but capped to not cross a closed period).

---

## 1. Unit Conversion Engine

### 1.1 Model

```
Product
  base_unit: 'G' | 'ML' | 'PCS'
  allow_fractional: boolean
  default_sale_unit: UnitCode          // what the POS keypad opens with
  default_purchase_unit: UnitCode      // what GRN opens with
  quantity_precision: 0 | 1 | 2 | 3    // decimals allowed in entered_qty

UnitConversion (per product, 0..N rows)
  unit_code: UnitCode                  // 'KG','L','PACKET','CARTON','BORI','DOZEN','PCS','G','ML'
  factor_to_base: NUMERIC(18,6)        // 1 unit_code = factor_to_base base units
  is_purchase_unit: boolean
  is_sale_unit: boolean
  barcode: string | null               // carton-level barcode
  price_override_paise: bigint | null  // optional unit-specific price (else derived)
```

### 1.2 Canonical conversion table (system defaults, per base unit)

| Base | Unit | `factor_to_base` | Notes |
|---|---|---|---|
| G | G | 1 | identity |
| G | KG | 1000 | |
| G | QUINTAL | 100000 | rare, P2 |
| G | PACKET | product-defined (e.g. 500) | packet weight varies per SKU |
| G | BORI / SACK | product-defined (e.g. 50000 = 50 kg) | |
| G | CARTON | product-defined | |
| ML | ML | 1 | |
| ML | L | 1000 | |
| ML | PACKET | product-defined (e.g. 500) | pouch milk |
| ML | CRATE | product-defined | |
| PCS | PCS | 1 | |
| PCS | DOZEN | 12 | |
| PCS | PACKET | product-defined (e.g. 6) | |
| PCS | CARTON | product-defined (e.g. 24) | |

**Rule UC-1.** `KG→G` and `L→ML` factors are system constants and MUST NOT be editable per product. `PACKET`, `CARTON`, `BORI`, `CRATE` factors are per-product and MUST be positive.

**Rule UC-2.** A product MUST have a `UnitConversion` row for its base unit with `factor_to_base = 1`. Seeded automatically on product create.

**Rule UC-3 (no chained conversion).** All conversions are single-hop to base. A carton is never defined as "1 carton = 4 packets"; it is defined as "1 carton = 96 pcs". This eliminates rounding drift and cycle detection.

### 1.3 Conversion functions

```ts
// entered → base
toBase(enteredQty: Decimal, unit: UnitCode, conv: UnitConversion[]): Decimal {
  const row = conv.find(c => c.unit_code === unit);
  assert(row, `UNIT_NOT_CONVERTIBLE:${unit}`);
  return enteredQty.mul(row.factor_to_base);   // exact, NUMERIC math
}

// base → display (largest sensible unit)
fromBase(baseQty: Decimal, baseUnit: BaseUnit): { qty: Decimal; unit: UnitCode } {
  if (baseUnit === 'G'  && baseQty.gte(1000)) return { qty: baseQty.div(1000), unit: 'KG' };
  if (baseUnit === 'ML' && baseQty.gte(1000)) return { qty: baseQty.div(1000), unit: 'L'  };
  return { qty: baseQty, unit: baseUnit };
}
```

**Rule UC-4 (display formatting).** `1500 g` renders as `1.5 kg`; `750 g` renders as `750 g`; `2400 ml` renders as `2.4 L`. The **invoice** MUST print the unit the operator entered (`entered_qty`/`entered_unit`) *and* the base equivalent when they differ and the store enables `print.show_base_qty`.

**Rule UC-5 (precision guard).** `entered_qty` is rejected if it has more decimals than `quantity_precision`. Base conversion result is rounded to 4 decimals, half-up. For `PCS` products with `allow_fractional = false`, non-integer `entered_qty` is rejected with `ERR_FRACTIONAL_NOT_ALLOWED`.

### 1.4 Price derivation across units

Products carry `sell_rate_paise` **expressed per `pricing_unit`** (usually the default sale unit — e.g. ₹45/kg for sugar, ₹10/pc for biscuits).

```
rate_per_base_unit = sell_rate_paise / factor_to_base(pricing_unit)
line_gross_paise   = ROUND( rate_per_base_unit × qty_base , 0 )    // to whole paise, HALF_UP
```

**Worked example (loose sugar).**
- `sell_rate_paise = 4500` per `KG`, `pricing_unit = KG`, `factor = 1000`.
- `rate_per_base = 4500 / 1000 = 4.5` paise per gram (kept as Decimal, not rounded).
- Customer buys 250 g → `qty_base = 250`.
- `line_gross = ROUND(4.5 × 250) = ROUND(1125) = 1125` paise = **₹11.25**. ✔

**Worked example (rounding exposure).**
- `sell_rate_paise = 3333` per `KG` (₹33.33/kg). `rate_per_base = 3.333` p/g.
- 150 g → `3.333 × 150 = 499.95` → `ROUND → 500` paise = ₹5.00.
- The 0.05 paise difference is absorbed at the line; it MUST NOT be redistributed.

**Rule PR-1.** If `UnitConversion.price_override_paise` exists for the chosen unit, it wins over derivation (e.g. carton sold at a discount: ₹1,000/carton instead of 24 × ₹45). The override is treated as the line gross for `entered_qty = 1` of that unit and scales linearly.

**Rule PR-2 (MRP ceiling).** `effective_unit_price` MUST NOT exceed batch `mrp_paise` scaled to the same unit. Violations block the sale with `ERR_PRICE_ABOVE_MRP` unless the user holds `pos.override_mrp` (audited).

**Rule PR-3 (price source precedence), highest first:**
1. Line-level manual price override (permission `pos.price_override`, audited)
2. `UnitConversion.price_override_paise`
3. `InventoryBatch.selling_price_paise` (batch-specific pricing, when `inventory.batch_pricing = true`)
4. `Product.sell_rate_paise`

---

## 2. Pricing, Discounts & Tax Calculation

### 2.1 Terminology

| Term | Meaning |
|---|---|
| `gross` | qty × unit price, before any discount |
| `line_discount` | discount applied to that line only |
| `cart_discount_share` | this line's apportioned share of a cart-level discount |
| `taxable_value` | amount on which GST is computed |
| `tax_amount` | CGST + SGST (intra-state) or IGST (inter-state) |
| `line_net` | taxable_value + tax_amount |
| `invoice_total` | Σ line_net + charges − round_off |

### 2.2 Order of operations (MANDATORY sequence)

```
1. line_gross          = ROUND(unit_price_base × qty_base)
2. line_discount       = flat OR ROUND(line_gross × pct / 100)
3. line_after_line_disc= line_gross − line_discount
4. cart_discount       = flat OR ROUND(Σ line_after_line_disc × pct / 100)
5. apportion cart_discount across lines pro-rata on line_after_line_disc  (§2.5)
6. line_pre_tax_amount = line_after_line_disc − cart_discount_share
7. split line_pre_tax_amount into taxable_value + tax_amount per tax mode (§2.3/2.4)
8. invoice_subtotal    = Σ taxable_value
9. invoice_tax         = Σ tax_amount   (also grouped by rate slab for the GST summary)
10. charges            = delivery/packing etc. (taxed per their own HSN, or exempt)
11. round_off          = ROUND_TO_RUPEE(subtotal + tax + charges) − (subtotal + tax + charges)
12. invoice_total      = subtotal + tax + charges + round_off
```

**Rule TX-0.** Tax is computed **per line, after all discounts**. Never compute tax on gross and then discount the tax.

### 2.3 Tax-EXCLUSIVE products (`Product.tax_inclusive = false`)

```
taxable_value = line_pre_tax_amount
tax_amount    = ROUND(taxable_value × gst_rate / 100)
line_net      = taxable_value + tax_amount
```

**Example.** Soap, ₹100.00 pre-tax (`10000` paise), GST 18%.
`taxable = 10000`; `tax = ROUND(10000 × 0.18) = 1800`; `line_net = 11800` → ₹118.00.

### 2.4 Tax-INCLUSIVE products (`Product.tax_inclusive = true`) — the Indian MRP default

```
taxable_value = ROUND( line_pre_tax_amount × 100 / (100 + gst_rate) )
tax_amount    = line_pre_tax_amount − taxable_value
line_net      = line_pre_tax_amount
```

**Rule TX-1.** `tax_amount` is derived by **subtraction**, never by independent rounding, so `taxable + tax` always reconciles to the price the customer sees. This is the single most common source of one-paise invoice mismatches; do it this way.

**Example.** Biscuit MRP ₹20.00 (`2000` paise), GST 18%, inclusive.
`taxable = ROUND(2000 × 100 / 118) = ROUND(1694.915…) = 1695`
`tax = 2000 − 1695 = 305`
Split intra-state: `CGST = 152`, `SGST = 153` (see TX-2).

### 2.5 CGST/SGST/IGST split

```
if (supply_type === 'INTRA_STATE') {
  cgst = FLOOR(tax_amount / 2);
  sgst = tax_amount − cgst;        // remainder paise goes to SGST, deterministically
  igst = 0;
} else {
  igst = tax_amount; cgst = sgst = 0;
}
```

**Rule TX-2.** The odd paise MUST go to SGST (deterministic, documented) so two systems computing the same invoice agree byte-for-byte.

**Rule TX-3 (supply type).** `INTRA_STATE` when `store.state_code === customer.state_code` OR customer has no GSTIN (B2C within state, the default for both archetypes). `INTER_STATE` only for B2B with a GSTIN from another state.

### 2.6 Cart-level discount apportionment

```
base_i   = line_after_line_disc_i
totalBase= Σ base_i  (over discountable lines only)
share_i  = FLOOR(cart_discount × base_i / totalBase)     // for i = 1..n
residual = cart_discount − Σ share_i
// assign residual paise (0..n−1 paise) to lines in descending base_i order, 1 paise each
```

**Rule DS-1.** Lines flagged `discount_exempt = true` (e.g. loose tobacco, already-discounted promo items) are excluded from `totalBase` and receive no share.
**Rule DS-2.** `Σ cart_discount_share` MUST equal `cart_discount` exactly. Unit test with prime-number amounts (e.g. ₹7.77 across 3 lines) is mandatory.
**Rule DS-3.** Discount can never make `line_pre_tax_amount < 0`. Cap at 0 and surface `ERR_DISCOUNT_EXCEEDS_LINE`.
**Rule DS-4.** Role ceilings: `discount_max_pct` per role (CASHIER 5%, MANAGER 20%, OWNER 100% by default). Exceeding triggers supervisor override (audited with approver id).

### 2.7 Round-off

```
round_off = ROUND_TO_NEAREST_RUPEE(pre_round_total) − pre_round_total   // range −50..+49 paise
invoice_total = pre_round_total + round_off
```
Store flag `tax.round_off_mode ∈ {NEAREST, UP, DOWN, NONE}`; default `NEAREST`. `round_off` is stored as a signed value on the order and printed as a separate line — it MUST NOT be silently folded into a line.

### 2.8 Full worked invoice (RETAIL, intra-state)

| Line | Item | Qty | Unit ₹ | Gross | Line disc | After | Cart 5% share | Pre-tax | Rate | Taxable | Tax | Net |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sugar (excl) | 2 kg | 45.00/kg | 90.00 | 0 | 90.00 | 4.50 | 85.50 | 5% | 85.50 | 4.28 | 89.78 |
| 2 | Biscuit (incl MRP) | 3 pc | 20.00 | 60.00 | 5.00 | 55.00 | 2.75 | 52.25 | 18% | 44.28 | 7.97 | 52.25 |
| 3 | Soap (excl) | 1 pc | 100.00 | 100.00 | 0 | 100.00 | 5.00 | 95.00 | 18% | 95.00 | 17.10 | 112.10 |

- Cart discount base = 90.00 + 55.00 + 100.00 = ₹245.00 → 5% = ₹12.25 → shares 4.50 / 2.75 / 5.00 (Σ = 12.25 ✔)
- Subtotal (taxable) = 85.50 + 44.28 + 95.00 = **₹224.78**
- Tax = 4.28 + 7.97 + 17.10 = **₹29.35** (CGST 14.67 / SGST 14.68)
- Pre-round = 254.13 → round_off = **−0.13** → **Invoice total ₹254.00**

GST summary block on the invoice:

| Rate | Taxable | CGST | SGST | Total tax |
|---|---|---|---|---|
| 5% | 85.50 | 2.14 | 2.14 | 4.28 |
| 18% | 139.28 | 12.53 | 12.54 | 25.07 |

---

## 3. Batch, Expiry & FEFO Allocation

### 3.1 Batch identity
A batch is unique per `(store_id, product_id, batch_no, expiry_date)`. Re-receiving the same batch tops up `current_stock` and recomputes weighted-average cost:

```
new_cost = ROUND( (old_stock × old_cost + in_qty × in_cost) / (old_stock + in_qty) )
```

For products with `inventory.batch_tracking = false` (typical KIRANA), the system auto-creates a **single implicit batch** per product with `batch_no = 'DEFAULT'`, `expiry_date = NULL`. All existing logic then works unchanged — no branching in the allocation code.

### 3.2 FEFO allocation algorithm

```ts
function allocate(productId, requiredBase: Decimal, ctx): Allocation[] {
  const batches = SELECT * FROM inventory_batches
    WHERE store_id = :store AND product_id = :p
      AND current_stock > 0
      AND status = 'ACTIVE'
      AND (expiry_date IS NULL OR expiry_date >= :today)   // FEFO-3
    ORDER BY
      (expiry_date IS NULL) ASC,        // dated batches consumed before undated
      expiry_date ASC,                  // FEFO: earliest expiry first
      received_at ASC,                  // FIFO tiebreak
      id ASC                            // deterministic + deadlock-safe lock order
    FOR UPDATE;                         // row locks inside checkout txn

  let remaining = requiredBase, out = [];
  for (const b of batches) {
    if (remaining.lte(0)) break;
    const take = Decimal.min(b.current_stock, remaining);
    out.push({ batch_id: b.id, qty_base: take, cost: b.cost_price_paise });
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0)) {
    if (store.inventory.negative_stock_allowed) {
      out.push({ batch_id: fallbackBatch(productId).id, qty_base: remaining, oversold: true });
    } else {
      throw new InsufficientStock(productId, requiredBase, requiredBase.minus(remaining));
    }
  }
  return out;
}
```

**Rule FEFO-1.** One cart line MAY split across multiple batches. The order stores **one `OrderItem` per batch allocation** (so cost/margin is exact), while the UI collapses them into one visual line via `line_group_id`.
**Rule FEFO-2.** Manual batch override (permission `inventory.batch_override`) pins the allocation to one batch and skips FEFO; audited with reason.
**Rule FEFO-3.** Expired batches are excluded from allocation. If `store.inventory.hard_block_expired = false`, they are *still* excluded from automatic FEFO but MAY be selected manually with permission + audit (e.g. selling near-expiry at discount is a manual, deliberate act).
**Rule FEFO-4.** Locks are always taken in ascending `id` order across the whole checkout (all products' batches sorted globally before locking) to guarantee deadlock freedom — see `SYSTEM_ARCHITECTURE.md` §4.3.

### 3.3 Expiry alert horizons

| Bucket | Default window | Severity | Action surfaced |
|---|---|---|---|
| `EXPIRING_SOON` | ≤ 30 days | info | Dashboard list, value at risk |
| `EXPIRING_URGENT` | ≤ 7 days | warning | Daily digest, suggest markdown |
| `EXPIRED` | < today | critical | Blocked from sale, write-off suggested |

Alerts are computed by a scheduled job (daily at `store.day_start_time + 15min`) writing to an `alert` table; the POS additionally computes a **live** chip at line-add time from the allocated batch, so the cashier sees expiry risk even if the job hasn't run.

**Rule EXP-1.** Expiry comparison uses the store's local date, not UTC.
**Rule EXP-2.** Write-off of expired stock creates `stock_movement` with `type = WRITE_OFF_EXPIRY`, reason code mandatory, and is excluded from COGS-on-sale but included in shrinkage reporting.

### 3.4 Stock movement types (exhaustive)

| Type | Sign | Source document |
|---|---|---|
| `OPENING` | + | Store setup / product create |
| `PURCHASE_IN` | + | GRN |
| `PURCHASE_RETURN` | − | Debit note |
| `SALE` | − | Order |
| `SALE_RETURN` | + | Credit note |
| `ADJUSTMENT_IN` | + | Stock adjustment (count surplus, correction) |
| `ADJUSTMENT_OUT` | − | Damage, theft, sampling, correction |
| `WRITE_OFF_EXPIRY` | − | Expiry write-off |
| `TRANSFER_OUT` / `TRANSFER_IN` | −/+ | Inter-store transfer (P2) |

**Rule MOV-1.** `stock_movement` is append-only. Corrections are new movements, never updates or deletes.
**Rule MOV-2.** Invariant, asserted nightly: for every batch, `current_stock = Σ(signed movement qty)`. Mismatch → P1 alert with batch id, no auto-heal.

---

## 4. Customer Credit (Khata) Ledger

### 4.1 Double-entry model

Ledger rows are immutable. Each row:

```
customer_ledger_entry
  id, store_id, customer_id
  entry_type: 'SALE_CREDIT' | 'PAYMENT_RECEIVED' | 'OPENING_BALANCE'
            | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'WRITE_OFF' | 'ADJUSTMENT'
  direction: 'DEBIT' | 'CREDIT'        // DEBIT = customer owes more
  amount_paise: BIGINT  (> 0 always)
  running_balance_paise: BIGINT        // signed; + = customer owes us (Dr)
  reference_type / reference_id        // order, payment, credit_note
  entry_date, created_by, note
```

**Sign convention (binding):** positive balance = customer owes the store (Debit balance). A ₹1,240 khata shows `+124000`.

| Event | direction | balance effect |
|---|---|---|
| Credit sale ₹500 | DEBIT | +50000 |
| Payment received ₹300 | CREDIT | −30000 |
| Sales return credit note ₹100 | CREDIT | −10000 |
| Opening balance owed ₹1,000 | DEBIT | +100000 |
| Bad debt write-off ₹200 | CREDIT | −20000 |

**Rule LED-1.** `running_balance_paise` is computed **inside the same transaction** as the insert, by selecting the latest entry `FOR UPDATE` (or via an advisory lock keyed on `customer_id`). Two concurrent credit sales to the same customer MUST serialise.
**Rule LED-2.** `Customer.current_balance_paise` is a cached mirror of the last entry's running balance. It is never the source of truth; a nightly job asserts `customer.current_balance == last_entry.running_balance` and alerts on drift.
**Rule LED-3.** No row is ever updated or deleted. Reversals are new `ADJUSTMENT` rows referencing the original.

### 4.2 Credit limit enforcement

```
headroom = credit_limit_paise − current_balance_paise
allowed  = headroom >= credit_amount_of_this_bill
```

| `store.credit.enforcement_mode` | Behaviour when `!allowed` |
|---|---|
| `BLOCK` | Hard reject. Cashier must take cash or reduce the bill. |
| `WARN` | Confirmation dialog showing overshoot amount; proceeds on confirm; audited. |
| `ALLOW_WITH_APPROVAL` (default) | Requires a user with `credit.exceed_limit` permission (supervisor PIN); audited with approver. |

**Rule CR-1.** `credit_limit_paise = 0` means **no limit** (common for kirana regulars). `NULL` is not used. A limit of exactly zero rupees is expressed as `credit_limit_paise = 0 AND credit_limit_enabled = false` vs `= true` for a genuine zero limit — implemented as a separate boolean to avoid the ambiguity.
**Rule CR-2 (offline).** Offline, the client evaluates against the **last synced** limit and the **locally reconstructed** balance (last synced balance + locally queued credit sales − locally queued payments). On sync, the server re-evaluates against true state; if the bill now breaches in `BLOCK` mode, it goes to the Exception Queue with `CREDIT_LIMIT_BREACH` (never auto-voided).
**Rule CR-3.** Credit days overdue: an invoice is `OVERDUE` when `today > invoice_date + customer.credit_days` and it has unallocated balance. Ageing buckets: 0–30, 31–60, 61–90, 90+.

### 4.3 Settlement & allocation

```ts
interface SettlementRequest {
  customer_id: string;
  amount_paise: number;
  method: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE';
  reference?: string;
  allocations?: { order_id: string; amount_paise: number }[]; // omit for auto-FIFO
}
```

**Rule ST-1 (auto-FIFO).** With no explicit allocations, the payment is applied to open invoices oldest-first. Each `invoice_allocation` row records `(payment_id, order_id, amount_paise)`.
**Rule ST-2.** `Σ allocations.amount_paise ≤ payment.amount_paise`. Any unallocated remainder becomes **on-account credit** (reduces balance, allocated later automatically on next credit sale).
**Rule ST-3.** Invoice settlement status derived: `UNPAID` (0 allocated), `PARTIALLY_SETTLED` (0 < allocated < total), `SETTLED` (allocated ≥ total).
**Rule ST-4.** Overpayment is allowed and produces a negative (Credit) balance; it MUST be shown as "Advance ₹X" in the UI, not as a negative due.
**Rule ST-5.** A settlement received during an open shift with `method = CASH` increments `shift.cash_collections_paise` and therefore the expected drawer amount.

### 4.4 WhatsApp receipt payload

MVP uses a **share deep link only** (no Business API). The payload builder is a pure function so Phase 2 can swap the transport.

```ts
function buildWhatsAppPayload(ctx: {
  kind: 'RECEIPT' | 'STATEMENT' | 'REMINDER';
  store: StoreSummary; customer: CustomerSummary;
  order?: OrderSummary; balance_paise: number; lang: 'hi' | 'en';
}): { url: string; text: string };
```

Trigger points (all user-initiated in MVP):
- After a credit sale, the receipt screen shows a **WhatsApp** button.
- From the customer statement screen.
- From the overdue list (bulk generation produces a queue of links, one tap each — no automated send).

Text template (hi, RECEIPT):
```
नमस्ते {{customer_name}} 🙏
{{store_name}} से खरीद: ₹{{order_total}}
बिल नंबर: {{invoice_no}} · दिनांक: {{date}}
अब तक कुल बकाया: ₹{{balance}}
धन्यवाद!
```

**Rule WA-1.** Phone MUST be normalised to E.164 (`91XXXXXXXXXX`) before building the link; invalid numbers disable the button with a hint rather than producing a broken link.
**Rule WA-2.** The payload MUST NOT contain more than the last 10 line items; longer bills link to a summary only (message length limits).

---

## 5. Cash Drawer & Shift Reconciliation

### 5.1 Shift lifecycle

```
OPEN ──(close requested)──> PENDING_COUNT ──(count submitted)──> CLOSED
  │                                                                 ▲
  └──(supervisor force close, audited)──────────────────────────────┘
```

**Rule SH-1.** At most one `OPEN` shift per `(store_id, counter_id)`. Enforced by a partial unique index.
**Rule SH-2.** A user MAY have only one open shift across all counters in a store.
**Rule SH-3.** Every order, return, settlement and cash movement created while a shift is open MUST carry `shift_id`. Orders created offline carry the `shift_id` that was open on that device at creation time.
**Rule SH-4.** A shift MUST NOT close while the device has unsynced bills or parked carts belonging to it (`ERR_SHIFT_HAS_PENDING`). Supervisor force-close moves pending items to the store's exception queue and is audited.

### 5.2 Expected cash formula

```
expected_cash_paise =
    opening_float_paise
  + cash_sales_paise                 // Σ payments where method = CASH on orders in shift
  + cash_settlements_paise           // khata payments received in cash during shift
  + cash_in_paise                    // manual cash additions (e.g. float top-up)
  − cash_refunds_paise               // cash paid out on sales returns
  − cash_payouts_paise               // supplier paid in cash, petty expense, bank drop
```

**Rule SH-5.** Non-cash tenders (CARD/UPI/WALLET/CREDIT) NEVER affect expected cash. They are reconciled separately against settlement reports (`card_expected`, `upi_expected` shown for information, variance not blocking in MVP).

### 5.3 Denomination count

Cashier enters counts, not a total:

```ts
interface DenominationCount {
  d2000?: number; d500?: number; d200?: number; d100?: number;
  d50?: number;   d20?: number;  d10?: number;  d5?: number;
  d2?: number;    d1?: number;   coins_paise?: number;  // misc coin total
}
actual_cash_paise = Σ(denomination_value × count) × 100 + coins_paise
```

### 5.4 Variance handling

```
variance_paise = actual_cash_paise − expected_cash_paise
// negative = SHORTAGE (money missing), positive = OVERAGE
```

| Condition | Behaviour |
|---|---|
| `variance == 0` | Close normally |
| `0 < |variance| ≤ store.shift.variance_tolerance_paise` (default ₹10) | Close allowed; reason optional; logged |
| `|variance| > tolerance` | Reason code MANDATORY (`MISCOUNT`, `CHANGE_ERROR`, `UNRECORDED_PAYOUT`, `THEFT_SUSPECTED`, `OTHER` + free text) **and** supervisor approval required |
| `|variance| > store.shift.variance_escalation_paise` (default ₹500) | Additionally raises a manager alert and flags the shift `UNDER_REVIEW` |

**Rule SH-6.** Variance is recorded to `shift.variance_paise` and to the audit log with the counting user and approving user. It is never silently absorbed into an account.
**Rule SH-7.** Once `CLOSED`, a shift is immutable. Corrections are separate `cash_adjustment` entries referencing the shift.

### 5.5 Z-Report contents (printed at close)

Header (store, counter, cashier, open/close time, shift id) · Tender-wise totals (cash, card, UPI, wallet, credit) · Bill count, average bill value, items sold · Discounts given (count + value) · Voids and returns (count + value, with approver) · Cash movements (float, in, out, refunds) · Expected vs actual vs variance · GST summary by slab · Top 10 products by value.

**Rule SH-8.** The Z-report is generated server-side from committed data (never from client state) and is reproducible on demand.

---

## 6. Offline Behaviour Specification (functional view)

*(Protocol mechanics live in `SYSTEM_ARCHITECTURE.md` §5; this section defines the business rules.)*

| ID | Rule |
|---|---|
| OFF-001 | Selling, printing, customer lookup, khata display and parking carts MUST work fully offline. |
| OFF-002 | Purchases/GRN, shift close, settlement of another device's bill, and reports REQUIRE connectivity (attempting them offline shows a clear "needs internet" state, not a spinner). |
| OFF-003 | Offline bills get a provisional number `{STORE_CODE}-OFF-{device_seq}` and a `client_uuid`. The final invoice number is assigned by the server on sync and replaces the provisional number everywhere, with the provisional retained in `provisional_no` for reprint matching. |
| OFF-004 | An offline bill MUST be printable immediately, and the printed copy MUST be marked `अस्थायी / PROVISIONAL` until synced when `store.print.mark_provisional = true`. |
| OFF-005 | Stock shown offline is last-known-synced minus locally queued sales. It is labelled as an estimate in RETAIL mode. |
| OFF-006 | The system MUST NOT block a sale because local stock shows zero when `negative_stock_allowed = true`; it warns. |
| OFF-007 | Sync rejections never delete data. They populate the Exception Queue with a Hindi/English cause and a resolution action set (§PRD 5.5). |
| OFF-008 | Duplicate submission (retry, double tap, resumed worker) MUST produce exactly one server-side effect, keyed on `client_uuid`. |

---

## 7. Validation Rules & Error Catalogue

### 7.1 Cart-level validations (client + server, server authoritative)

| Code | Condition | Mode |
|---|---|---|
| `ERR_EMPTY_CART` | No lines | block |
| `ERR_QTY_INVALID` | qty ≤ 0, or precision/fractional violation | block |
| `ERR_UNIT_NOT_CONVERTIBLE` | Unit not in product's conversions | block |
| `ERR_PRICE_ABOVE_MRP` | Effective price > batch MRP | block unless `pos.override_mrp` |
| `ERR_DISCOUNT_EXCEEDS_LINE` | Discount > line amount | block |
| `ERR_DISCOUNT_ABOVE_ROLE_CAP` | Discount % > role cap | supervisor override |
| `ERR_INSUFFICIENT_STOCK` | Allocation short & negative stock disallowed | block |
| `ERR_EXPIRED_BATCH` | Selected batch expired | block unless permission |
| `ERR_CUSTOMER_REQUIRED` | CREDIT tender without customer | block |
| `ERR_CREDIT_LIMIT_BREACH` | Headroom exceeded | per enforcement mode |
| `ERR_PAYMENT_MISMATCH` | Σ payments ≠ invoice_total | block |
| `ERR_NO_OPEN_SHIFT` | Shift required by store config and none open | block |
| `ERR_STORE_MISMATCH` | Any referenced entity belongs to another store | block + security alert |

### 7.2 Server response shape (uniform)

```ts
interface ApiError {
  code: string;                 // from the catalogue above
  message: string;              // English, developer-facing
  message_localized?: { hi?: string; en?: string };  // user-facing
  field?: string;               // dotted path, e.g. "items[2].qty_base"
  details?: Record<string, unknown>;  // e.g. { available: 1200, requested: 2000 }
  resolutions?: ResolutionAction[];   // for sync exceptions
  trace_id: string;
}
```

---

## 8. Audit Requirements

Every row in `audit_log` MUST carry: `store_id`, `actor_user_id`, `approver_user_id?`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `reason_code?`, `reason_text?`, `ip`, `device_id`, `occurred_at`, `prev_hash`, `hash`.

**Rule AUD-1.** `hash = SHA256(prev_hash || canonical_json(row_without_hash))` — a per-store hash chain making tampering detectable.
**Rule AUD-2.** Mandatory audited actions: price override, discount above cap, line void, invoice cancel, return, batch override, expired-batch sale, stock adjustment, credit limit override, shift variance, force shift close, permission/role change, product price change, reprint.
**Rule AUD-3.** Audit writes occur **in the same transaction** as the audited change. A failed audit write fails the business operation.

---

## 9. Localization

- Supported: `hi` (Devanagari), `en`. String catalogue in `next-intl` message files; no hardcoded user-facing strings.
- Numbers use Indian grouping (`1,23,456.78`) in both locales.
- Dates: `DD/MM/YYYY` display; ISO 8601 in APIs and storage.
- Product names carry `name` (English/store language) and `name_local` (Hindi/regional); search MUST match both, plus a transliteration index (e.g. "chini" → "चीनी").
- Receipts print in `store.print.language`, independent of UI language.

---

## 10. Acceptance-Test Seeds (must exist in the seed dataset)

1. Loose product, base `G`, priced per KG, `quantity_precision = 0` → validates UC-5 and PR-1.
2. Product with carton barcode, `CARTON → 24 PCS` → validates UC-3 and scan-to-carton.
3. MRP-inclusive 18% product at ₹20 → validates TX-1 exact split (1695/305).
4. Product with two batches, expiries T+5 and T+40 → validates FEFO-1 split allocation.
5. Expired batch with stock > 0 → validates FEFO-3 exclusion.
6. Customer with `credit_limit = ₹2,000`, balance ₹1,900 → validates CR-2 offline/online divergence.
7. Customer with overpayment (advance) → validates ST-4.
8. Cart of 3 lines with ₹7.77 cart discount → validates DS-2 residual apportionment.
9. Two counters selling the same single-unit-remaining batch simultaneously → validates NFR-C01.
10. Shift with ₹2,000 float, mixed tenders, one ₹250 payout → validates SH-5 expected cash.
