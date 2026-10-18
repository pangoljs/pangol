import { defineAuth } from 'hyperflat'
import { db } from './db.js'

// Bearer token -> user (or undefined). The returned object becomes c.user.
export default defineAuth({
  resolve: (token) => db.sessions.userForToken(token),
})
