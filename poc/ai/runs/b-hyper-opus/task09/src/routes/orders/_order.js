import { t } from 'hyperflat'

// Public shape of an order: paymentToken is never exposed.
export const orderSchema = t.object({
  id: t.string(),
  userId: t.string(),
  productId: t.string(),
  quantity: t.int(),
  total: t.number(),
})
