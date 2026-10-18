import { t } from 'hyperflat'

// paymentToken is deliberately not part of the view.
export const orderView = t.object({
  id: t.string(),
  userId: t.string(),
  productId: t.string(),
  quantity: t.int({ min: 1 }),
  total: t.number({ min: 0 }),
})
