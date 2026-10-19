import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { serve } from 'pangol/node'

// No skip/fallback: this command must exercise real PostgreSQL and Keycloak.
test('real Keycloak -> HTTP -> PostgreSQL: CRUD, isolation, permission, filtering and rollback', { timeout: 90_000 }, async () => {
  assert.ok(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a disposable database')
  const issuer = process.env.TEST_KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8080/realms/pangol-test'
  assert.ok(issuer.endsWith('/realms/pangol-test'), 'Use the isolated pangol-test realm')
  const schema = 'test_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new URL(process.env.TEST_DATABASE_URL)
  db.searchParams.set('options', `-c search_path=${schema}`)
  process.env.DATABASE_URL = db.href
  process.env.KEYCLOAK_ISSUER = issuer
  process.env.KEYCLOAK_AUDIENCE = 'pangol-api'
  const { pool, posts, userId, transaction } = await import('../src/db.js')
  let server: ReturnType<typeof serve> | undefined
  try {
    await pool.query(await readFile(new URL('../migrations/001-initial.sql', import.meta.url), 'utf8'))
    const token = async (who: string) => {
      const result = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST',
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: `test-${who}`, client_secret: `test-only-${who}` }), signal: AbortSignal.timeout(5000) })
      assert.equal(result.status, 200)
      return (await result.json() as { access_token: string }).access_token
    }
    const alice = await token('alice'), bob = await token('bob'), reader = await token('reader')
    const { app } = await import('../src/app.js')
    server = serve(app, { hostname: '127.0.0.1', port: 0 })
    await new Promise<void>(resolve => server!.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const request = (path: string, credential?: string, method = 'GET', body?: object) => fetch(base + path, {
      method, headers: { ...(credential && { authorization: `Bearer ${credential}` }), ...(body && { 'content-type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
    })
    assert.equal((await request('/health')).status, 200)
    assert.equal((await request('/posts')).status, 401)
    assert.equal((await request('/posts', 'forged')).status, 401)
    assert.equal((await request('/posts', reader, 'POST', { title: 'denied' })).status, 403)
    const me = await (await request('/me', alice)).json() as { id: string }
    assert.equal((await (await request('/me', alice)).json() as { id: string }).id, me.id)
    const other = await (await request('/me', bob)).json() as { id: string }
    const title = "Robert'); DROP TABLE posts;--"
    const created = await request('/posts', alice, 'POST', { title, ownerId: other.id, internalNote: 'injected' })
    assert.equal(created.status, 201)
    const post = await created.json() as { id: string; title: string; ownerId: string }
    assert.deepEqual(post, { id: post.id, title, ownerId: me.id })
    assert.equal((await posts.get(post.id))?.internalNote, 'server-only')
    assert.equal((await request('/posts', alice, 'POST', { title: '' })).status, 400)
    assert.deepEqual(await (await request('/posts', bob)).json(), [])
    assert.deepEqual(await (await request('/posts', alice)).json(), [post])
    assert.deepEqual(await (await request(`/posts/${post.id}`, alice)).json(), post)
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const payload = method === 'PATCH' ? { title: 'stolen' } : undefined
      const denied = await request(`/posts/${post.id}`, bob, method, payload)
      const missing = await request(`/posts/${randomUUID()}`, bob, method, payload)
      assert.equal(denied.status, 404); assert.equal(missing.status, 404)
      assert.deepEqual(await denied.json(), await missing.json())
    }
    assert.equal(await posts.update(post.id, other.id, 'race'), undefined)
    assert.equal(await posts.remove(post.id, other.id), false)
    const changed = await request(`/posts/${post.id}`, alice, 'PATCH', { title: 'updated', ownerId: other.id })
    assert.equal(changed.status, 200)
    assert.deepEqual(await changed.json(), { ...post, title: 'updated' })
    assert.equal((await pool.query('SELECT * FROM post_events WHERE post_id = $1', [post.id])).rowCount, 1)
    const rollbackId = randomUUID()
    await assert.rejects(transaction(async client => {
      await client.query('INSERT INTO posts (id, owner_id, title) VALUES ($1, $2, $3)', [rollbackId, me.id, 'rollback'])
      throw new Error('force rollback')
    }), /force rollback/)
    assert.equal(await posts.get(rollbackId), undefined)
    // Failure of the second statement must roll back create itself, not merely a synthetic transaction.
    await pool.query("ALTER TABLE post_events ADD CONSTRAINT reject_test_event CHECK (action <> 'created') NOT VALID")
    const countBefore = (await posts.list(me.id)).length
    await assert.rejects(posts.create(me.id, 'event must fail'))
    assert.equal((await posts.list(me.id)).length, countBefore)
    await pool.query('ALTER TABLE post_events DROP CONSTRAINT reject_test_event')
    assert.notEqual(await userId(issuer + '-other', 'same-subject'), await userId(issuer, 'same-subject'))
    assert.equal((await request(`/posts/${post.id}`, alice, 'DELETE')).status, 204)
    assert.equal((await request(`/posts/${post.id}`, alice)).status, 404)
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())) }
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
