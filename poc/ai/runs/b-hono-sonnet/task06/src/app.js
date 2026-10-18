import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const fail = (c, status, error) => c.json({ error }, status)

const publicUser = ({ passwordHash, ...rest }) => rest

// Returns the signed-in user, null when no credentials were sent, or undefined when they are invalid.
function authenticate(c) {
  const header = c.req.header('authorization')
  if (!header) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!m) return undefined
  return db.sessions.userForToken(m[1])
}

const requireAuth = async (c, next) => {
  const user = authenticate(c)
  if (!user) return fail(c, 401, 'Authentication required')
  c.set('user', user)
  await next()
}

const requirePermission = (permission) => async (c, next) => {
  if (!c.get('user').permissions.includes(permission)) return fail(c, 403, 'Forbidden')
  await next()
}

async function readJson(c) {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : undefined
  } catch {
    return undefined
  }
}

app.notFound((c) => fail(c, 404, 'Not found'))
app.onError((err, c) => {
  console.error(err)
  return fail(c, 500, 'Internal server error')
})

// Returns { post } or { res }. Authors and moderators may modify; others get 404 for
// drafts (so their existence is not leaked) and 403 for published posts.
function loadEditablePost(c) {
  const user = c.get("user")
  const post = db.posts.get(c.req.param("id"))
  if (!post) return { res: fail(c, 404, "Post not found") }
  const allowed = post.authorId === user.id || user.permissions.includes("posts:moderate")
  if (!allowed) return { res: post.published ? fail(c, 403, "Forbidden") : fail(c, 404, "Post not found") }
  return { post }
}

app.delete('/posts/:id', requireAuth, (c) => {
  const { post, res } = loadEditablePost(c)
  if (res) return res
  db.posts.delete(post.id)
  return c.body(null, 204)
})

export default app
