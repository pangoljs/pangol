// Same in-memory data for every JS implementation (Go has an identical copy).
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
// token -> session. 't-read' can only read, 't-admin' can read and write.
export const sessions = new Map([
  ['t-read', { id: 'u-read', permissions: ['users:read'] }],
  ['t-admin', { id: 'u-admin', permissions: ['users:read', 'users:write'] }],
])
