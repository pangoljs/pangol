// The same in-memory data for every server.
export const users = new Map()
for (let i = 1; i <= 1000; i++) {
  users.set(String(i), {
    id: String(i),
    name: `User ${i}`,
    email: `user${i}@example.com`,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$hashhashhashhash', // must never leave the server
    role: i % 10 === 0 ? 'admin' : 'member',
  })
}
// token -> user. 't-read' reads only its own record (id 42); 't-admin' reads any record and writes.
export const sessions = new Map([
  ['t-read', { id: '42', permissions: ['users:read'] }],
  ['t-admin', { id: '1', permissions: ['users:read', 'users:write', 'admin'] }],
])
// The owner rule every server applies on GET /users/:id; failing it answers 404 like a missing record.
export const canRead = (user, record) => record.id === user.id || user.permissions.includes('admin')
