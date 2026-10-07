import { z } from 'zod';

const bookItemSchema = z.object({
  product_id: z.string().min(1),
  entered_qty: z.string().min(1),
  entered_unit: z.string().min(1),
  unit_price_paise: z.number().int().nonnegative().optional(), // omit -> product.sell_rate_paise
});

export const bookB2bOrderSchema = z.object({
  client_uuid: z.string().uuid(),
  customer_id: z.string().min(1),
  route: z.string().optional(),
  vehicle_no: z.string().optional(),
  items: z.array(bookItemSchema).min(1, 'ERR_EMPTY_CART'),
  note: z.string().optional(),
});

export type BookB2bOrderRequest = z.infer<typeof bookB2bOrderSchema>;
export type BookB2bOrderItemInput = z.infer<typeof bookItemSchema>;

export const dispatchB2bOrderSchema = z.object({
  order_ids: z.array(z.string().min(1)).min(1),
  vehicle_no: z.string().optional(),
  transporter: z.string().optional(),
  driver_name: z.string().optional(),
  freight_paise: z.number().int().nonnegative().optional(),
  freight_terms: z.enum(['PAID_BY_STORE', 'TO_PAY_BY_CUSTOMER']).optional(),
});
export type DispatchB2bOrderRequest = z.infer<typeof dispatchB2bOrderSchema>;

export const deliverB2bOrderSchema = z.object({
  order_id: z.string().min(1),
});
export type DeliverB2bOrderRequest = z.infer<typeof deliverB2bOrderSchema>;
