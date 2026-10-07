import { z } from 'zod';

/** API_CONTRACTS.md §2.1 — validated with Zod at the service boundary (400 on failure). */

const discountSchema = z.object({
  type: z.enum(['FLAT', 'PCT']),
  value: z.number().nonnegative(), // Milestone 5 hardening: pricing.ts already clamps negatives, but reject them at the boundary instead
});

const createOrderItemSchema = z.object({
  line_group_id: z.string().min(1),
  product_id: z.string().min(1),
  entered_qty: z.string().min(1),
  entered_unit: z.string().min(1),
  qty_base: z.string().optional(),
  batch_id: z.string().optional(),
  unit_price_paise: z.number().int().nonnegative().optional(),
  price_source: z.enum(['PRODUCT', 'BATCH', 'UNIT_OVERRIDE', 'MANUAL']).optional(),
  line_discount: discountSchema.optional(),
  note: z.string().optional(),
});

const createOrderPaymentSchema = z.object({
  method: z.enum(['CASH', 'CARD', 'UPI', 'WALLET', 'CREDIT', 'BANK_TRANSFER', 'CHEQUE']),
  amount_paise: z.number().int().positive(),
  tendered_paise: z.number().int().nonnegative().optional(),
  reference: z.string().optional(),
  provider: z.string().optional(),
});

export const createOrderRequestSchema = z.object({
  client_uuid: z.string().uuid(),
  counter_id: z.string().optional(),
  shift_id: z.string().optional(),
  customer_id: z.string().optional(),
  order_type: z.enum(['SALE', 'RETURN']),
  original_order_id: z.string().optional(),

  items: z.array(createOrderItemSchema).min(1, 'ERR_EMPTY_CART'),
  cart_discount: discountSchema.optional(),
  charges: z
    .array(z.object({ code: z.string(), label: z.string(), amount_paise: z.number().int(), gst_rate: z.number().optional(), hsn_code: z.string().optional() }))
    .optional(),
  payments: z.array(createOrderPaymentSchema).min(1),

  client_totals: z.record(z.string(), z.unknown()).optional(),

  provisional_no: z.string().optional(),
  client_created_at: z.string(),
  is_offline_origin: z.boolean(),
  note: z.string().optional(),
  approval_tokens: z.array(z.string()).optional(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type CreateOrderItemInput = z.infer<typeof createOrderItemSchema>;
export type CreateOrderPaymentInput = z.infer<typeof createOrderPaymentSchema>;
