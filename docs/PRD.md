# PRD.md — Unified POS & Smart Inventory Management System

**Codename:** DUKAAN Core
**Version:** 1.0 (Implementation Baseline)
**Stack:** Next.js 14 (App Router, Tailwind, Zustand) · Strapi v5 (Headless, PostgreSQL 15+)
**Status:** Approved for build
**Owner:** Principal TPM / Enterprise Architecture

---

## 1. Executive Summary

DUKAAN Core is a single-engine, single-schema retail operating system that serves two structurally different retail archetypes without forking the codebase or the database:

- **Archetype A — Village / Rural Kirana (Parchun) Store.** One operator, no barcodes on most SKUs, goods sold loose by weight or volume (250 g sugar, 500 ml mustard oil, 1.5 kg atta), heavy informal credit (*khata / udhar*), low-spec Android devices, intermittent 2G/3G connectivity, 58 mm thermal receipts.
- **Archetype B — Modern Supermarket / Shopping Mall.** Multiple simultaneous checkout counters, high-speed barcode scanning, cashier shifts with cash drawer reconciliation, batch and expiry discipline (FEFO), carton→piece and sack→kg unit conversions, supplier purchase orders, and strict role-based access.

The strategic bet is that these are **not two products**. They are two **configuration profiles** over one domain model. Both sell "a quantity of a product from a batch at a price with a tax treatment, collected via one or more tenders, optionally against a customer's ledger." Every divergence (barcode vs. quick-grid, single operator vs. shift, always-online vs. offline-first) is expressed as a **store-level feature flag plus a UI mode**, never as a schema branch.

**Why this matters commercially:** a kirana that grows into a two-counter minimart, or a supermarket chain that opens a rural feeder outlet, migrates by flipping flags — not by data migration. One support surface, one QA surface, one upgrade path.

### 1.1 Success Metrics (MVP exit criteria)

| Metric | Target | Measured by |
|---|---|---|
| Kirana bill completion (5 loose items, credit sale) | ≤ 25 s from first tap to printed receipt | In-app instrumentation, p90 |
| Mall checkout throughput (20 barcoded items, split tender) | ≤ 60 s, p90 | In-app instrumentation |
| Scan-to-cart latency | ≤ 120 ms p95 (local cache hit) | Client timing marks |
| Offline bill durability | 0 lost bills across forced kill / battery pull | Chaos test suite |
| Sync conflict rate requiring manual intervention | < 0.5% of offline bills | Sync exception queue |
| Stock ledger integrity | `Σ(movements) == batch.current_stock` for 100% of batches, nightly | Reconciliation job |
| Cash drawer variance flagged | 100% of shifts with |variance| > ₹0 logged with reason | Shift close audit |

---

## 2. Vision & Product Principles

**Vision.** Any Indian retailer — from a ₹8,000/day parchun counter in a village to a ₹40 lakh/month mall supermarket — runs their entire commercial truth (stock, money owed, money held, expiry risk) on one system that works when the internet does not.

**Principles (binding on all design decisions):**

1. **The bill must never be blocked.** No network call, no lock wait, no validation may stand between the operator and a completed sale. Everything else is negotiable.
2. **Integers, not floats.** All money is stored in **paise (integer)**. All quantities are stored in **base units as `NUMERIC(18,4)`**. Floating point never touches a monetary or stock value.
3. **The server owns identity.** Clients propose (UUID idempotency keys, draft numbers); the server disposes (final invoice numbers, final stock state, final ledger balances).
4. **Every stock change is a movement row.** `current_stock` is a derived convenience column, always reconstructible from the immutable `stock_movement` ledger.
5. **Every rupee of credit is double-entry.** The khata is not a number on a customer row; it is the sum of an append-only ledger.
6. **Configuration over branching.** Two business models, one schema, zero `if (isKirana)` in the domain services — only in presentation and policy layers.
7. **Degrade, don't fail.** No printer → show QR/WhatsApp. No scale → manual weight entry. No barcode → quick grid. No server → local queue.

---

## 3. Target Personas

### 3.1 Ramesh — Kirana Owner-Operator (Primary, Archetype A)
- **Context:** 42, owns a 200 sq ft parchun shop. Runs the counter himself; his son helps evenings. Device: ₹9,000 Android phone, 4 GB RAM, cracked screen, 58 mm Bluetooth/USB thermal printer, sometimes an electronic weighing scale he reads visually.
- **Literacy:** Comfortable in Hindi/Hinglish; reads numbers fluently, English labels slowly. Types with one thumb.
- **Jobs to be done:** Bill a customer in under 30 seconds while three people wait. Know instantly what Sharma-ji owes. Not lose the udhar record when his phone dies. Know when sugar stock is finishing.
- **Pain today:** Paper khata register (lost, disputed, illegible), mental arithmetic on loose weights, no idea of true margin.
- **Non-negotiables:** Works with no internet. Big tap targets. Hindi labels. Customer name search by phone digits. One-tap "Add to Khata."
- **Explicitly does NOT want:** Shift management, purchase orders, barcode discipline, role hierarchies.

### 3.2 Sunita — Mall Cashier (Primary, Archetype B)
- **Context:** 24, one of 6 cashiers across 4 counters. Works an 8-hour shift on a wired POS terminal with USB scanner, cash drawer, 80 mm printer, card terminal.
- **Jobs to be done:** Scan fast, handle split payments (card + cash + wallet), apply the promo the customer insists exists, close her drawer at shift end without a shortage she has to explain.
- **Measured on:** Items per minute, drawer variance, void/return count.
- **Non-negotiables:** Keyboard-first (scanner is a keyboard). Sub-150 ms scan feedback. No modal she has to mouse-click past. Cannot delete a line without a supervisor PIN.

### 3.3 Vikram — Store Manager (Secondary, Archetype B)
- **Jobs:** Approve voids/returns/discounts above threshold, resolve drawer variances, action expiry alerts before write-off, approve GRN price variances, monitor counter-wise sales.
- **Needs:** Audit trail with names and timestamps, exception dashboards, shift reports, FEFO compliance visibility.

### 3.4 Anil — Inventory / Purchase Clerk (Secondary, both archetypes)
- **Jobs:** Receive supplier delivery, create batches with MRP/expiry/cost, reconcile invoice vs. physical, record supplier payments, run cycle counts.
- **Needs:** Fast inwarding (barcode or SKU), unit conversion at receipt (buy 1 carton → 24 pcs; buy 1 bori → 50 kg), landed-cost capture, supplier outstanding view.

### 3.5 Priya — Owner / Multi-Store Admin (Secondary)
- **Jobs:** Compare stores, set price and tax masters, define roles, view consolidated P&L inputs, export for CA/GST filing.
- **Needs:** Tenant isolation guarantees, immutable audit log, export in GSTR-compatible shape (Phase 2 for filing itself).

---

## 4. Store Modes & Feature Flags

A `Store` carries `default_mode: 'KIRANA' | 'RETAIL'` plus an overridable flag set. Mode is a **preset**, not a constraint — a kirana can enable batches; a mall cannot disable shifts without an owner override.

| Flag | KIRANA preset | RETAIL preset | Effect |
|---|---|---|---|
| `pos.quick_grid_enabled` | true | true (secondary) | Tap-to-add product grid |
| `pos.barcode_primary` | false | true | Focus trap on scan input; grid demoted |
| `pos.loose_quantity_entry` | true | true (rare SKUs) | Numeric keypad with unit selector (g/kg/ml/L) |
| `pos.scale_integration` | optional | optional | Serial/BT weight capture |
| `inventory.batch_tracking` | false (default) | true | Forces batch selection / FEFO |
| `inventory.expiry_tracking` | false | true | Expiry alerts, blocked sale of expired |
| `inventory.negative_stock_allowed` | true | false | Oversell policy (see §6.4) |
| `credit.khata_enabled` | true | optional | Credit tender, ledger, limits |
| `shift.enabled` | false | true | Drawer float, reconciliation, counter binding |
| `purchase.po_workflow` | false (direct GRN only) | true | PO → GRN → Bill matching |
| `sync.offline_first` | true | true (degraded fallback) | IndexedDB queue + outbox |
| `tax.gst_enabled` | optional | true | GST computation and breakup on invoice |
| `print.paper_width` | 58mm | 80mm | Receipt template |

---

## 5. User Journeys & End-to-End Workflows

### 5.1 Journey K1 — Kirana Fast Billing with Loose Items + Khata Credit

**Actor:** Ramesh. **Device:** Android phone, offline. **Goal:** Bill 4 items, 3 of them loose, charge to Sharma-ji's khata, print, in < 30 s.

| # | Step | System behaviour |
|---|---|---|
| 1 | Opens app (cold start, offline) | Hydrates last-synced product catalogue from IndexedDB; POS screen interactive in ≤ 2.5 s on 4 GB device |
| 2 | Taps "Cheeni (Sugar)" in quick grid | Product added with `qty = 1 × base unit`? **No** — product's `default_sale_unit = kg` and `requires_quantity_prompt = true`, so a numeric keypad opens immediately with unit chips `g | kg` |
| 3 | Types `250`, selects `g` | Line resolves: 250 g → base 250 g (base unit = g). Price = `rate_per_base × 250`, rounded per §REQ tax rules. Line shows "Cheeni · 250 g · ₹11.25" |
| 4 | Taps "Sarson Tel", types `500`, `ml` | Same flow. Base unit ml. |
| 5 | Taps "Parle-G", quantity defaults to 1 pc | `requires_quantity_prompt = false` for piece goods → single tap adds 1 |
| 6 | Long-press Parle-G line → `+` twice | Qty 3. Line total recomputed. |
| 7 | Taps customer field, types `98` | Local fuzzy search over cached customers by phone suffix and name → "Sharma-ji · 9876543210 · Balance ₹1,240 Dr" |
| 8 | Selects Sharma-ji | Cart binds `customer_id`. Header shows current outstanding and credit limit headroom. |
| 9 | Taps **Khata (Udhar)** | Tender = `CREDIT` for full amount. Credit limit check runs against **locally cached** limit and locally known balance (§6.3 handles stale-limit risk). |
| 10 | Taps **Save & Print** | (a) Bill is written to IndexedDB with `client_uuid` + provisional number `KIR-OFF-000147`; (b) cart cleared, UI free in ≤ 150 ms; (c) print job dispatched to ESC/POS; (d) outbox worker attempts sync in background |
| 11 | (Later, connectivity returns) | Sync worker posts bill; server assigns final `INV/2026-27/K1/000391`, creates stock movements, posts ledger debit, returns mapping; local record upgraded; receipt reprint shows final number |

**Edge cases handled:** duplicate tap on Save (idempotency key), app killed between (a) and (c) (bill survives, print retried from bill list), customer added on the fly (`quick_create_customer` with name + phone only), khata payment received later (§5.4).

---

### 5.2 Journey M1 — Mall High-Speed Checkout with Split Tender

**Actor:** Sunita at Counter 3. **Precondition:** Shift open with ₹2,000 opening float.

| # | Step | System behaviour |
|---|---|---|
| 1 | Login with PIN, selects Counter 3 | System asserts no other open shift on Counter 3; creates `Shift` with `opening_float = 200000` paise |
| 2 | Scans EAN-13 | Keyboard-wedge input captured by global scan listener (terminator `\r`, debounce 30 ms). Lookup order: in-memory index → IndexedDB → API. Line added with FEFO-allocated batch. Audible beep + row highlight ≤ 120 ms |
| 3 | Scans a carton-barcode for the same product | `UnitConversion` resolves carton → 24 pcs; one line, `qty_base = 24` |
| 4 | Scans an item whose only in-stock batch expires tomorrow | Line added; soft warning chip "Expires in 1 day" (does not block). Expired batch would block (`hard_block_expired = true`) |
| 5 | Customer wants a line removed | Sunita's role lacks `pos.void_line` → supervisor PIN modal → Vikram authorises → audit row written with both user ids |
| 6 | Applies cart-level 5% discount | Role-capped at 10%; beyond that requires supervisor. Discount apportioned across taxable lines pro-rata (§REQ 3.4) |
| 7 | Payment: ₹500 cash + ₹1,347 card | Split tender screen; cash tendered ₹500, card reference captured; `balance_due` drives to 0 before Finish enables |
| 8 | Finish | Atomic server transaction: reserve→decrement batches, write movements, write order + items + payments, increment counter sequence, return invoice number. 80 mm receipt prints with GST breakup |
| 9 | End of shift | Shift close screen: expected cash = float + cash sales − cash refunds − payouts. Sunita enters denomination-wise physical count. Variance computed, reason required if non-zero, shift locked, Z-report printed |

---

### 5.3 Journey I1 — Inventory Inwarding, Batch Creation, Supplier Payment

| Phase | Steps |
|---|---|
| **PO (RETAIL only)** | Anil creates Purchase Order → lines with product, ordered qty (in purchase unit, e.g. cartons), expected rate. Status `DRAFT → SENT`. |
| **Delivery / GRN** | Goods arrive. Anil opens PO (or creates direct GRN in KIRANA mode). For each line: scans/selects product, enters **received qty in purchase unit**, batch no, mfg date, expiry date, cost price (ex-tax), MRP, selling price. System converts purchase unit → base units via `UnitConversion`. |
| **Variance** | If `received_qty ≠ ordered_qty` or `actual_rate` deviates > tolerance (configurable, default 2%), GRN enters `PENDING_APPROVAL`; Vikram approves or rejects. |
| **Posting** | On approve: `InventoryBatch` rows created (or topped up if same batch_no + product), `stock_movement` rows `type = PURCHASE_IN`, supplier ledger credited with bill amount. |
| **Landed cost** | Freight/loading entered at bill level is apportioned by value across lines into `landed_cost_per_base_unit` (used for margin reporting, not for tax). |
| **Payment** | Anil records supplier payment (cash/bank/UPI) → supplier ledger debit → outstanding reduces. Partial payments supported; ageing buckets 0-30/31-60/61-90/90+. |
| **Returns** | Purchase return creates negative movement `PURCHASE_RETURN` against the specific batch and a debit note in supplier ledger. |

---

### 5.4 Journey C1 — Khata Settlement

1. Sharma-ji arrives with ₹1,000 against a ₹1,240 balance.
2. Ramesh opens customer → **Receive Payment** → amount ₹1,000, mode Cash.
3. System posts ledger `CREDIT` entry, recomputes running balance to ₹240 Dr.
4. Allocation: FIFO against oldest open invoices by default; manual allocation allowed (`settlement_allocations[]`). Partial allocation leaves an invoice `PARTIALLY_SETTLED`.
5. Receipt printed; optional WhatsApp payload queued (deep link `wa.me/91XXXXXXXXXX?text=<encoded receipt summary + balance>`) — no WhatsApp Business API in MVP, only share-intent/deep-link (§Out of scope).

---

### 5.5 Journey S1 — Offline → Online Reconciliation (exception path)

When a queued offline bill fails server validation (e.g., stock went negative beyond policy, customer exceeded credit limit set while offline, batch was written off), the bill does **not** silently vanish:

- Server returns `409` with a structured `SyncRejection`.
- Bill moves to client **Exception Queue** with human-readable cause in Hindi/English.
- Operator resolves: accept-with-adjustment (system posts a stock adjustment), reassign batch, convert credit→cash, or void with reason.
- All resolutions are audited. Nothing is auto-discarded.

---

## 6. Functional Requirements

IDs are stable and referenced by `REQUIREMENTS.md`, test cases, and the backlog.
Priority: **P0** = MVP blocking, **P1** = MVP desirable, **P2** = Phase 2.

### 6.1 POS & Checkout

| ID | Requirement | Pri |
|---|---|---|
| POS-001 | Add item to cart via barcode scan (EAN-8/13, UPC-A, Code128), keyboard-wedge capture with configurable terminator | P0 |
| POS-002 | Add item via quick grid: category-tabbed, frequency-sorted, image-optional tiles, ≥ 56 px tap target | P0 |
| POS-003 | Add item via text search (name, alias/Hindi name, SKU, partial barcode); results ≤ 100 ms from local index | P0 |
| POS-004 | Fractional quantity entry with unit chips filtered to the product's convertible units | P0 |
| POS-005 | Capture weight from connected scale (Web Serial / Bluetooth SPP) into the active line, with manual override always available | P1 |
| POS-006 | Per-line: quantity edit, price override (permission-gated), line discount (₹ or %), remove (permission-gated), note | P0 |
| POS-007 | Cart-level discount (₹ or %) with role-based ceiling and supervisor escalation | P0 |
| POS-008 | Multiple parked/held carts per counter, resumable, labelled, survive refresh | P0 |
| POS-009 | Split tender across CASH, CARD, UPI, WALLET, CREDIT with per-tender reference capture | P0 |
| POS-010 | Cash tendered → change due calculation with common-denomination quick buttons | P0 |
| POS-011 | Credit tender requires a bound customer; blocked if limit exceeded per policy | P0 |
| POS-012 | Returns/refunds against an original invoice (full or partial line-level), reversing stock and ledger | P1 |
| POS-013 | Reprint last / any invoice; reprint is audit-logged and marked "DUPLICATE" on paper | P0 |
| POS-014 | Void an unpaid draft; cancel a posted invoice only via credit-note flow with approval | P1 |
| POS-015 | Keyboard shortcuts for all RETAIL actions (F-keys), fully mouse-free checkout | P0 |
| POS-016 | Hindi/English UI toggle at store and user level | P0 |

### 6.2 Inventory

| ID | Requirement | Pri |
|---|---|---|
| INV-001 | Product master: name, local alias, SKU, multiple barcodes, category, HSN, base unit, tax rate, MRP, sell rate, reorder level | P0 |
| INV-002 | Unit conversion definitions per product (base unit + N convertible units with factors) | P0 |
| INV-003 | Batch creation with batch no, mfg date, expiry date, cost, MRP, selling price, opening qty | P0 |
| INV-004 | FEFO allocation on sale when batch tracking is on; FIFO fallback when no expiry present | P0 |
| INV-005 | Manual batch override at line level (permission-gated), audited | P1 |
| INV-006 | Expiry alerts at configurable horizons (default 30/15/7/expired), dashboard + daily digest | P1 |
| INV-007 | Hard block on selling expired batches (configurable per store) | P0 |
| INV-008 | Stock adjustment (damage, theft, sampling, correction) with mandatory reason code and approval above threshold | P0 |
| INV-009 | Stock transfer between stores of the same tenant (out → in with in-transit state) | P2 |
| INV-010 | Cycle count / physical stocktake session: freeze scope, count, variance report, post adjustments | P1 |
| INV-011 | Immutable `stock_movement` ledger; `current_stock` reconcilable to it | P0 |
| INV-012 | Low-stock and dead-stock (no movement in N days) reports | P1 |

### 6.3 Credit / Customer Ledger

| ID | Requirement | Pri |
|---|---|---|
| LED-001 | Customer master: name, phone (unique per store), address, credit limit, credit days, opening balance | P0 |
| LED-002 | Double-entry append-only ledger; balance is derived, never directly mutated | P0 |
| LED-003 | Credit limit enforcement modes: `BLOCK`, `WARN`, `ALLOW_WITH_APPROVAL` (per store) | P0 |
| LED-004 | Partial settlement with FIFO auto-allocation and manual re-allocation | P0 |
| LED-005 | Customer statement (date range) with opening, transactions, closing; printable and shareable | P0 |
| LED-006 | Ageing buckets and overdue flagging based on `credit_days` | P1 |
| LED-007 | WhatsApp share payload generation (deep link, no API) for receipts, statements, reminders | P1 |
| LED-008 | Offline credit sale allowed against cached limit; server re-validates on sync (§5.5) | P0 |
| LED-009 | Credit note issuance on sales return, adjustable against future bills | P1 |

### 6.4 Purchasing & Suppliers

| ID | Requirement | Pri |
|---|---|---|
| PUR-001 | Supplier master with GSTIN, payment terms, contact | P0 |
| PUR-002 | Direct GRN (KIRANA) without PO | P0 |
| PUR-003 | PO → GRN → Purchase Bill 3-way matching (RETAIL) | P1 |
| PUR-004 | Purchase unit → base unit conversion at receipt | P0 |
| PUR-005 | Landed-cost apportionment (freight, loading, other) by line value | P1 |
| PUR-006 | Supplier ledger with payments, debit notes, ageing | P0 |
| PUR-007 | Purchase return against a specific batch | P1 |
| PUR-008 | Auto-suggest reorder list from reorder level + velocity | P2 |

### 6.5 Shifts, Counters & Cash

| ID | Requirement | Pri |
|---|---|---|
| SHF-001 | Open shift with counter binding and opening float; one open shift per counter | P0 |
| SHF-002 | All orders stamped with `shift_id` and `counter_id` | P0 |
| SHF-003 | Mid-shift cash in/out (payout, bank drop) with reason and approval | P1 |
| SHF-004 | Shift close: expected vs. denomination-wise actual, variance, mandatory reason if non-zero | P0 |
| SHF-005 | Z-report: tender-wise totals, bill count, voids, discounts, returns, variance | P0 |
| SHF-006 | Shift cannot close with unsynced offline bills or open parked carts (must resolve first) | P0 |
| SHF-007 | Supervisor can force-close an abandoned shift with audit reason | P1 |

### 6.6 Multi-Tenant, Identity & Access

| ID | Requirement | Pri |
|---|---|---|
| TEN-001 | Every domain row carries `store_id`; all queries are store-scoped by policy, not by caller discipline | P0 |
| TEN-002 | Tenant = organisation; a tenant owns 1..N stores; users are granted per-store roles | P0 |
| TEN-003 | Roles: OWNER, MANAGER, CASHIER, INVENTORY_CLERK, ACCOUNTANT (+ custom in P2), permission-based not role-hardcoded | P0 |
| TEN-004 | PIN login for POS terminals; full credential login for admin surfaces | P0 |
| TEN-005 | Supervisor override flow: elevated user authorises a specific action without session switch, both identities audited | P0 |
| TEN-006 | Immutable audit log for: price override, discount above threshold, void, return, stock adjustment, shift variance, permission change, batch override | P0 |
| TEN-007 | Cross-store data access is impossible by construction (policy + row filter + tests) | P0 |

### 6.7 Reporting (MVP scope)

| ID | Requirement | Pri |
|---|---|---|
| RPT-001 | Day book: sales, collections, expenses, closing cash | P0 |
| RPT-002 | Tender-wise and counter-wise sales summary | P0 |
| RPT-003 | Product-wise / category-wise sales with margin (using landed cost) | P1 |
| RPT-004 | Outstanding receivables (customer) and payables (supplier) with ageing | P0 |
| RPT-005 | Stock valuation (at cost / at MRP) as of date | P1 |
| RPT-006 | GST summary: taxable value and tax by rate slab, B2C/B2B split | P1 |
| RPT-007 | Expiry risk report with value at risk | P1 |

---

## 7. Non-Functional Requirements

### 7.1 Performance

| ID | Requirement |
|---|---|
| NFR-P01 | POS interactive (TTI) ≤ 2.5 s cold on a 4 GB Android device over 3G; ≤ 1.0 s warm |
| NFR-P02 | Scan-to-line-render ≤ 120 ms p95 on local cache hit |
| NFR-P03 | Checkout POST (online) p95 ≤ 800 ms server-side; UI never waits — optimistic completion with rollback on hard failure |
| NFR-P04 | Local catalogue search ≤ 100 ms p95 over 20,000 SKUs (prebuilt inverted index in IndexedDB + in-memory LRU) |
| NFR-P05 | Initial catalogue sync ≤ 60 s for 20,000 SKUs on 3G (gzip + delta after first pull) |
| NFR-P06 | Strapi checkout transaction holds row locks < 50 ms typical |

### 7.2 Offline & Sync

| ID | Requirement |
|---|---|
| NFR-O01 | Full billing capability offline: catalogue, customers, prices, tax, khata balance (last known), printing |
| NFR-O02 | Durable outbox in IndexedDB; survives tab close, refresh, OS kill, battery pull |
| NFR-O03 | Exactly-once server effect via client `client_uuid` idempotency key with server-side dedupe table |
| NFR-O04 | Ordered replay per device; failures quarantine the failing bill without head-of-line blocking others (configurable; default: continue) |
| NFR-O05 | Deterministic conflict policy per §5.5, zero silent data loss |
| NFR-O06 | Clock skew tolerance: client timestamps recorded but server timestamp is authoritative for accounting periods |

### 7.3 Concurrency & Data Integrity

| ID | Requirement |
|---|---|
| NFR-C01 | Simultaneous checkouts on the same batch from 4+ counters must never oversell (when `negative_stock_allowed = false`) |
| NFR-C02 | Stock decrement, order write, ledger post, and sequence increment occur in **one** database transaction |
| NFR-C03 | Batch rows locked in deterministic order (by `id`) to prevent deadlock |
| NFR-C04 | Invoice numbering is gapless per (store, counter, financial year) under concurrency |
| NFR-C05 | Ledger balance derivable and reconciled nightly; mismatch raises a P1 alert |
| NFR-C06 | No monetary or stock arithmetic in JavaScript floats — integer paise + decimal.js/NUMERIC |

### 7.4 Availability, Security, Compliance

| ID | Requirement |
|---|---|
| NFR-A01 | Core POS degrades to offline-only on any backend outage; no hard dependency for selling |
| NFR-S01 | JWT with short TTL + refresh; PIN auth rate-limited and locked after N failures |
| NFR-S02 | RBAC enforced server-side on every route; client permission checks are UX only |
| NFR-S03 | PII (customer phone/address) encrypted at rest at column level; masked in logs |
| NFR-S04 | Audit log append-only, tamper-evident (hash chain), retained ≥ 7 years |
| NFR-S05 | GST invoice fields (GSTIN, HSN, tax breakup, invoice number format) compliant with Indian GST rules |
| NFR-S06 | Data export on demand (tenant owns their data), deletion policy documented |
| NFR-S07 | Backups: PITR with ≤ 5 min RPO; restore drill quarterly |

### 7.5 Usability & Accessibility
- Minimum tap target 44×44 px (56 px in KIRANA mode); primary actions reachable one-thumb on a 6" screen.
- Full flow operable without mouse (RETAIL) and without keyboard (KIRANA).
- Colour is never the only signal (expiry, low stock, overdue also carry icon + text).
- All destructive actions confirm with the object named ("Delete line: Cheeni 250 g?").

---

## 8. Scope Boundaries

### 8.1 In Scope — MVP
Unified POS (both modes), product & unit conversion master, batch + FEFO + expiry, customer khata with double-entry ledger, supplier + GRN + supplier ledger, shifts & drawer reconciliation, offline-first sync engine, ESC/POS printing (58/80 mm), barcode scanning, role-based access + supervisor override, audit log, core reports (RPT-001/002/004), Hindi/English UI, single-tenant-multi-store.

### 8.2 Out of Scope — MVP (explicitly deferred)
| Item | Rationale | Target |
|---|---|---|
| WhatsApp Business Cloud API (templated, automated sends) | Requires business verification + template approval; deep-link share covers 90% of value | Phase 2 |
| E-invoice (IRN) / e-way bill generation | Only applies above turnover thresholds most targets don't hit | Phase 2 |
| Loyalty points, coupons, complex promo engine (BOGO, tiered) | Cart-level + line-level discount covers MVP | Phase 2 |
| Payment gateway / card terminal integration (EDC) | Card reference captured manually in MVP | Phase 2 |
| Weighing-scale label printers (barcode-embedded weight labels) | Common in large supermarkets only | Phase 2 |
| Online ordering / customer app / delivery | Different product surface | Phase 3 |
| Accounting suite (P&L, balance sheet, TDS) | Export to Tally/CA instead | Phase 3 |
| Multi-currency | Single currency (INR) in MVP | Phase 3 |
| Franchise / central price push across tenants | Multi-store within one tenant only | Phase 2 |
| Native mobile app (React Native) | PWA covers MVP, installable + offline | Phase 2 |
| Real-time multi-device cart sharing | Parked carts are per-device in MVP | Phase 2 |

### 8.3 Phase 2 Headline Themes
1. Promotions & loyalty engine.
2. WhatsApp Business API + automated reminder cadence for overdue khata.
3. EDC / UPI dynamic QR integration with auto-reconciliation.
4. E-invoicing and GSTR-1/3B ready exports.
5. Multi-store transfers, central purchasing, consolidated dashboards.
6. Weight-embedded barcode labels and scale-printer integration.

---

## 9. Assumptions, Dependencies, Risks

**Assumptions**
- Single currency INR; single country tax regime (Indian GST).
- Each physical counter maps to one device; devices are not shared mid-shift without close/open.
- Catalogue size ≤ 50,000 SKUs per store (hard design ceiling for full local cache; above this, tiered cache).
- Printers reachable via Web Serial / Web Bluetooth / local print bridge on the device.

**Dependencies**
- Strapi v5 `documentId` semantics and Document Service API.
- PostgreSQL 15+ for `FOR UPDATE SKIP LOCKED`, generated columns, partial indexes.
- Browser support: Chromium ≥ 111 for Web Serial/Bluetooth (fallback: local bridge agent).

**Top Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| Offline oversell on shared SKUs across counters | Stock truth corrupted | Server-side authoritative decrement + policy-driven rejection + exception queue; batch reservation for online path |
| Stale credit limit causes over-extension | Financial loss to owner | Cached limit + server re-validation + `ALLOW_WITH_APPROVAL` default for offline credit above headroom |
| IndexedDB eviction under storage pressure on low-end devices | Lost offline bills | `navigator.storage.persist()`, outbox-first write ordering, size budget, aggressive catalogue pruning before bill pruning (bills never pruned) |
| Strapi transaction boundaries insufficient for multi-entity atomicity | Partial writes | All checkout logic in a custom service using a single Knex transaction, not Document Service per-entity calls |
| Printer/scale hardware fragmentation | Support burden | Adapter layer with capability detection + certified hardware list + manual fallbacks |
| Invoice number gaps under crash | Compliance issue | Sequence table incremented inside the same transaction as the order insert |

---

## 10. Release Gates

**Gate A — Schema & Services (M1).** Seeded tenant with 2 stores (one KIRANA, one RETAIL), 500 products, unit conversions, batches; checkout service passes concurrency suite (4 parallel workers, 1,000 orders, zero oversell, zero number gaps).

**Gate B — POS UI (M2).** Both modes complete a bill end-to-end online; scan p95 ≤ 120 ms; keyboard-only RETAIL flow certified.

**Gate C — Khata & Offline (M3).** 200 offline bills replay with 100% durability across 20 forced kills; exception queue exercised for all rejection classes.

**Gate D — Shifts & Hardware (M4).** Drawer reconciliation variance accuracy 100% against scripted scenarios; 58 mm and 80 mm receipts print on 3 certified printer models; Z-report matches day book to the paisa.
