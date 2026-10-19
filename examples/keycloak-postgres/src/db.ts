import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { config } from './config.js'

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 5000 })
pool.on('error', () => console.error('Idle database connection failed'))

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function userId(issuer: string, subject: string): Promise<string> {
  // Stable identity is (issuer, subject), never an email/username or a client-supplied ID.
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM app_users WHERE issuer = $1 AND subject = $2', [issuer, subject])
  if (existing.rows[0] !== undefined) return existing.rows[0].id

  const inserted = await pool.query<{ id: string }>(`INSERT INTO app_users (id, issuer, subject)
    VALUES ($1, $2, $3) ON CONFLICT (issuer, subject) DO NOTHING RETURNING id`, [randomUUID(), issuer, subject])
  if (inserted.rows[0] !== undefined) return inserted.rows[0].id

  // A concurrent first login inserted the row. A separate READ COMMITTED statement sees its
  // committed ID; combining INSERT and SELECT in one CTE could keep the old, empty snapshot.
  const winner = await pool.query<{ id: string }>(
    'SELECT id FROM app_users WHERE issuer = $1 AND subject = $2', [issuer, subject])
  if (winner.rows[0] === undefined) throw new Error('Identity disappeared during creation; retry the request')
  return winner.rows[0].id
}

export interface Post { id: string; title: string; ownerId: string; internalNote: string }
const columns = 'id, title, owner_id AS "ownerId", internal_note AS "internalNote"'
export const posts = {
  async list(owner: string): Promise<Post[]> {
    return (await pool.query<Post>(`SELECT ${columns} FROM posts WHERE owner_id = $1 ORDER BY id LIMIT 100`, [owner])).rows
  },
  async get(id: string): Promise<Post | undefined> {
    return (await pool.query<Post>(`SELECT ${columns} FROM posts WHERE id = $1`, [id])).rows[0]
  },
  async create(owner: string, title: string): Promise<Post> {
    return transaction(async client => {
      const id = randomUUID()
      const result = await client.query<Post>(`INSERT INTO posts (id, owner_id, title) VALUES ($1, $2, $3) RETURNING ${columns}`, [id, owner, title])
      await client.query('INSERT INTO post_events (post_id, actor_id, action) VALUES ($1, $2, $3)', [id, owner, 'created'])
      return result.rows[0]!
    })
  },
  async update(id: string, owner: string, title: string): Promise<Post | undefined> {
    // Repeat ownership in SQL: a load/owner check must not authorize a later unscoped write.
    return (await pool.query<Post>(`UPDATE posts SET title = $3 WHERE id = $1 AND owner_id = $2 RETURNING ${columns}`, [id, owner, title])).rows[0]
  },
  async remove(id: string, owner: string): Promise<boolean> {
    return (await pool.query('DELETE FROM posts WHERE id = $1 AND owner_id = $2', [id, owner])).rowCount === 1
  },
}
