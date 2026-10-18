import { t } from 'hyperflat'

// Public shape of a user: never exposes passwordHash or other internal fields.
export const userSchema = t.object({
  id: t.string(),
  name: t.string(),
  email: t.email(),
  role: t.string(),
})
