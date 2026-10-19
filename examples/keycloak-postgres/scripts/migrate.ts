import { readFile } from 'node:fs/promises'
import { pool, transaction } from '../src/db.js'
try {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(735019)")
    await client.query('CREATE TABLE IF NOT EXISTS example_migrations (version integer PRIMARY KEY)')
    const done = await client.query('SELECT version FROM example_migrations WHERE version = 1')
    if (done.rowCount === 0) {
      await client.query(await readFile(new URL('../migrations/001-initial.sql', import.meta.url), 'utf8'))
      await client.query('INSERT INTO example_migrations VALUES (1)')
    }
  })
  console.log('Migration 001 applied (or already present)')
} finally { await pool.end() }
