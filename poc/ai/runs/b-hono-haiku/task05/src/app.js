import { Hono } from 'hono'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

// Only title and body can be edited. Unknown fields (authorId, published, ...) are dropped.
const postEdit = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(10000).optional(),
  })
  .refine((d) => d.title !== undefined || d.body !== undefined, { message: 'Nothing to update' })

async function readJson(c) {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

app.patch('/posts/:id', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)

  const post = db.posts.get(c.req.param('id'))
  const isAuthor = post?.authorId === user.id
  const isModerator = user.permissions.includes('posts:moderate')

  // Drafts are only visible to their author and moderators, so others get the same answer as for a missing post.
  if (!post || (!post.published && !isAuthor && !isModerator)) {
    return c.json({ error: 'Post not found' }, 404)
  }
  if (!isAuthor && !isModerator) return c.json({ error: 'Forbidden' }, 403)

  const parsed = postEdit.safeParse(await readJson(c))
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)

  return c.json(db.posts.update(post.id, parsed.data))
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
