import { defineAuth } from 'hyperflat'
import { db } from './db.js'

export default defineAuth({
  resolve: (token) => db.sessions.userForToken(token),
})
