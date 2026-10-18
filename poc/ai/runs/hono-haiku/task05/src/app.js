import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => c.json({ error: 'Internal server error' }, 500))

// The user for the Authorization: Bearer token, or undefined.
const userFrom = (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

// The JSON body if it is an object, otherwise undefined.
const readBody = async (c) => {
  try {
    const data = await c.req.json()
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}

const signedIn = async (c, next) => {
  if (!userFrom(c)) return c.json({ error: 'Sign in required' }, 401)
  await next()
}

app.patch('/posts/:id', signedIn, async (c) => {
  const user = userFrom(c)
  const post = db.posts.get(c.req.param('id'))
  if (!post) return c.json({ error: 'Post not found' }, 404)
  if (post.authorId !== user.id && !user.permissions.includes('posts:moderate')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const input = await readBody(c)
  if (!input) return c.json({ error: 'Request body must be a JSON object' }, 400)

  const patch = {}
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || [...input.title].length < 1 || [...input.title].length > 200) {
      return c.json({ error: 'title must be a string of 1 to 200 characters' }, 400)
    }
    patch.title = input.title
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string' || [...input.body].length > 5000) {
      return c.json({ error: 'body must be a string of up to 5000 characters' }, 400)
    }
    patch.body = input.body
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'Provide title and/or body' }, 400)
  }

  const updated = db.posts.update(post.id, patch)
  const { id, title, body, authorId } = updated
  return c.json({ id, title, body, authorId })
})

export default app
