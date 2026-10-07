# End-to-End Lifecycle Test — Reconciliation Report

Store: **Shivam Interprices** · Generated: 2026-09-22T06:48:20.488Z

## 1. Records Created
| Type | Name | Document ID |
|---|---|---|
| Supplier | adani | lmhrvgqtuevk1bniztae3iqm |
| Supplier | itc | h0oejjrztp8mu9fi5fzxcn84 |
| Supplier | parle | l0jfpua19qu862yhw8rrwqu0 |
| Supplier | tata | s5c5rixlgmhtsl3qd6qij7u0 |
| Product | fortuneOil | jzrkmj1ciohrnhfj22qhzox0 |
| Product | atta | a83xiovgsi9chlkxurszdbv4 |
| Product | parleG | br7oz40osyo8sl6k338nm3nf |
| Product | tataSalt | pzsxw0fp3p34vx8hgyznbhju |
| Product | khulaHisaab | fcxa186fga5sgcf3y4uskpa9 |
| Customer | kisan | jogjv7sr0hkirjp7aews8rcw |
| Customer | radhe | yp57o2cjesj5r48mcx64d3nm |
| Customer | gupta | idjjeoeo2yt8fko03zb5193e |
| Customer | maaKali | ia3y9zjhb3zheoe0auqn6658 |

## 2. Inventory: Starting vs Ending Balance (base units)
| Product | Starting | Ending | Net Change |
|---|---|---|---|
| fortuneOil | 1640000 ml | 1890000 ml | +250000 ml |
| atta | 790000 g | 910000 g | +120000 g |
| parleG | 5950 pcs | 6940 pcs | +990 pcs |
| tataSalt | 2990000 g | 3488000 g | +498000 g |

## 3. Supplier Ledger (AP) Closing Balances
| Supplier | Before Payment | After Payment |
|---|---|---|
| Adani Wilmar Distributors | Rs.36000.00 | Rs.16000.00 |
| ITC FMCG Supply Hub | Rs.57000.00 | Rs.27000.00 |
| Parle Products Depot (no payment posted) | Rs.6000.00 | Rs.6000.00 |
| Tata Consumer Direct (no payment posted) | Rs.12500.00 | Rs.12500.00 |

## 4. Customer Ledger (AR) Closing Balances
| Customer | Entries | Closing Balance |
|---|---|---|
| kisan | 12 | Rs.6280.00 |
| radhe | 0 | Rs.0.00 |
| gupta | 0 | Rs.0.00 |
| maaKali | 0 | Rs.0.00 |

## 5. B2B Order / Dispatch Lifecycle
| Order | Customer | Total | Status |
|---|---|---|---|
| fef725cb-284a-4ff0-ac07-9bea48eaa75e | Kisan Super Mart | Rs.6160.00 | DELIVERED (invoice null/2026-27/C1/000042) |
| 6b1be4d8-3a0b-43ea-a319-3d16d17b5621 | Radhe Radhe Traders | Rs.3300.00 | DISPATCHED (challan CHAL-2026-0008) |
| 57293b58-696c-46e6-b4cb-2521956197ec | Gupta Brothers Store | Rs.3600.00 | BOOKED |
| 427bdc26-8e6c-4150-8190-3f87c89e36bf | Maa Kali Kirana | Rs.820.00 | BOOKED |

## 6. POS Bills (Shift)
| Bill | Description | Total | Invoice |
|---|---|---|---|
| 1 | 3 Pouches Fortune Oil (Cash) | Rs.405.00 | null/2026-27/C1/000037 |
| 2 | 1 Bag Atta + 2 pkts Salt (Cash) | Rs.468.00 | null/2026-27/C1/000038 |
| 3 | 10 pkts Parle-G (UPI) | Rs.60.00 | null/2026-27/C1/000039 |
| 4 | 2 Pouches Fortune Oil (Cash+Khata split) | Rs.270.00 | null/2026-27/C1/000040 |
| 5 | Khula Hisaab custom charge (Cash) | Rs.150.00 | null/2026-27/C1/000041 |

## 7. Shift Cash Reconciliation
| Component | Amount |
|---|---|
| Opening Float | Rs.2000.00 |
| + Cash Sales | Rs.1173.00 |
| + Cash Collections | Rs.0.00 |
| + Cash In | Rs.0.00 |
| - Cash Out (Petty Expense) | Rs.150.00 |
| - Cash Refunds | Rs.0.00 |
| **= Expected Cash** | **Rs.3023.00** |
| Counted (Actual) Cash | Rs.3023.00 |
| Variance | Rs.0.00 (NONE) |
| Shift Status | CLOSED |