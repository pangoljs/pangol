import { t } from 'hyperflat'

// What staff may see about a user. Never includes passwordHash or permissions.
export const publicUser = t.object({
  id: t.string(),
  name: t.string(),
  email: t.email(),
  role: t.enum(['admin', 'member']),
})
