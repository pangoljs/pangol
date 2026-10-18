import { t } from 'hyperflat'

export const postView = t.object({
  id: t.string(),
  authorId: t.string(),
  title: t.string(),
  body: t.string(),
  published: t.bool(),
})
