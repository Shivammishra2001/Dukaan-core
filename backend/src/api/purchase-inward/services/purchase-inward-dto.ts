import { z } from 'zod';

/** API_CONTRACTS.md §4.1 CreateGRNRequest shape (Milestone 6 exposes this at `POST /api/purchases/inward` per the brief, rather than `/api/inventory/grn`). */

const itemSchema = z.object({
  product_id: z.string().min(1),
  received_qty: z.string().min(1),
  received_unit: z.string().min(1),
  free_qty: z.string().optional(),
  batch_no: z.string().optional(),
  mfg_date: z.string().optional(),
  expiry_date: z.string().optional(),
  cost_rate_paise: z.number().int().nonnegative(),
  discount_paise: z.number().int().nonnegative().optional(),
  gst_rate: z.number().min(0).max(50).optional(),
  mrp_paise: z.number().int().nonnegative().optional(),
  selling_price_paise: z.number().int().nonnegative().optional(),
  update_product_sell_rate: z.boolean().optional(),
});

export const createPurchaseInwardSchema = z.object({
  client_uuid: z.string().uuid(),
  supplier_id: z.string().min(1),
  purchase_order_id: z.string().optional(),
  supplier_invoice_no: z.string().optional(),
  supplier_invoice_date: z.string().optional(),
  received_at: z.string().optional(),
  due_date: z.string().optional(),
  items: z.array(itemSchema).min(1, 'ERR_EMPTY_ITEMS'),
  freight_paise: z.number().int().nonnegative().optional(),
  other_charges_paise: z.number().int().nonnegative().optional(),
  bill_discount_paise: z.number().int().nonnegative().optional(),
  round_off_paise: z.number().int().optional(),
  payment: z
    .object({
      method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE']),
      amount_paise: z.number().int().positive(),
      reference: z.string().optional(),
    })
    .optional(),
  note: z.string().optional(),
});

export type CreatePurchaseInwardRequest = z.infer<typeof createPurchaseInwardSchema>;
export type PurchaseInwardItemInput = z.infer<typeof itemSchema>;
