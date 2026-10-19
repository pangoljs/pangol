import { defineAuth } from 'pangol'
import { config } from './config.js'
import { userId } from './db.js'
import { tokenVerifier } from './token.js'

const verify = tokenVerifier(config.issuer, config.audience)
export default defineAuth({ from: 'bearer', resolve: async req => {
  const identity = await verify(req.credential)
  if (identity === null) return null
  return { id: await userId(identity.issuer, identity.subject), permissions: identity.permissions }
} })
