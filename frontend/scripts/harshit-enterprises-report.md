# Harshit Enterprises — E2E Verification Summary

Generated: 2026-09-22T08:56:22.251Z

## Active Tenant
| Field | Value |
|---|---|
| Store Name | Harshit Enterprises |
| Store Code | HARSHIT01 |
| Login Phone | 9876543210 |
| Login Password | testpass123 |
| Role | OWNER |

## Ending Inventory
| Product | Final Stock (base unit) |
|---|---|
| Fortune Mustard Oil | 223 pcs (1L pouch) |
| Aashirvaad Shudh Chakki Atta | 390000 g |
| Parle-G Glucose Biscuits | 180000 g |
| Tata Salt Vaccum Evaporated | 0 g |
| Kurkure Masala Munch | 0 pcs |

## Supplier AP Closing Balances
| Supplier | Outstanding Payable |
|---|---|
| Adani Wilmar Supply Co. | Rs.12800.00 |
| ITC Wholesale Hub | Rs.28558.00 |

## Customer AR Closing Balances
| Customer | Outstanding Receivable |
|---|---|
| Kisan Super Mart | Rs.8110.00 |
| Radhe Traders | Rs.0.00 |

## Shift Drawer Cash Reconciliation
| Component | Amount |
|---|---|
| Opening Float | Rs.1500.00 |
| + Cash Sales | Rs.450.00 |
| - Petty Cash Out | Rs.120.00 |
| **= Expected Cash** | **Rs.1830.00** |
| Counted Cash | Rs.1830.00 |
| Variance | Rs.0.00 |

## Notes
- Challan numbers are server-generated sequential ids (CHAL-2026-0001, CHAL-2026-0002) — the requested literal "CHAL-H01" is not client-settable per backend/src/api/b2b-dispatch/services/b2b-dispatch.ts's nextChallanNo().
- Kurkure Masala Munch's master unit was seeded as CARTON (factor 48) — "BOX" is not a valid unit_code anywhere in the schema (types/inventory.ts's BaseUnit / the backend's VALID_UNITS_FOR_BASE table).
- Bill 3 ("Khula Hisaab" quick cash sale) is billed against a dedicated non-stock utility item (SKU KHULA-HISAAB, is_service=true), not one of the 5 master-catalogue SKUs — none of the 5 catalogue products were inwarded in quantities that would cover an untracked loose sale, and billing it against a real tracked SKU would oversell that product's inventory into the negative.