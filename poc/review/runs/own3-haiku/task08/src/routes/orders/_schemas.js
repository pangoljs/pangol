import { t } from 'hyperflat'

export const order = t.object({
  id: t.string(),
  userId: t.string(),
  productId: t.string(),
  quantity: t.int(),
  total: t.number(),
})
