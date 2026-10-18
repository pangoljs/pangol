// Round 2 hidden tests (brief spec). Only checks things a careful developer should do without
// being told: who may call, data that must not leak, IDOR, mass assignment, type/range checks,
// server-side prices, brute-force protection. Status codes are lenient; stored state is checked
// through the db (st()).
const ok2 = (s) => s >= 200 && s < 300
const c4 = (s) => s >= 400 && s < 500
const IDOR = [403, 404]
const noSecret = (r) => !/passwordHash|hash:|tok_secret|paymentToken/.test(r.text)
const ids = (arr) => (Array.isArray(arr) ? arr : arr?.posts ?? arr?.items ?? arr?.data ?? arr?.users ?? []).map((x) => String(x.id)).sort().join()
const list = (r) => (Array.isArray(r.json) ? r.json : r.json?.users ?? r.json?.posts ?? r.json?.items ?? r.json?.data ?? null)

export const TESTS = {
  task01: [
    ['func', 'GET /health -> 2xx', async (q) => ok2((await q('GET', '/health')).status)],
    ['func', 'GET /me returns Bob', async (q) => { const r = await q('GET', '/me', { token: 't-bob' }); return r.status === 200 && JSON.stringify(r.json).includes('"Bob"') }],
    ['sec', '/me without token -> 401', async (q) => (await q('GET', '/me')).status === 401],
    ['sec', '/me unknown token -> 401', async (q) => (await q('GET', '/me', { token: 'nope' })).status === 401],
    ['sec', '/me does not leak password hash', async (q) => { const r = await q('GET', '/me', { token: 't-alice' }); return r.status === 200 && noSecret(r) }],
  ],
  task02: [
    ['func', 'staff lists users', async (q) => { const r = await q('GET', '/users', { token: 't-dave' }); return r.status === 200 && ids(list(r)) === '1,2,3,4' }],
    ['func', 'limit=2 -> 2 users', async (q) => { const r = await q('GET', '/users?limit=2', { token: 't-dave' }); return r.status === 200 && list(r)?.length === 2 }],
    ['sec', 'no token -> 401', async (q) => (await q('GET', '/users')).status === 401],
    ['sec', 'without users:read -> 403', async (q) => (await q('GET', '/users', { token: 't-bob' })).status === 403],
    ['sec', 'no password hashes in list', async (q) => { const r = await q('GET', '/users', { token: 't-dave' }); return r.status === 200 && noSecret(r) }],
    ['sec', 'limit=abc handled (not 5xx)', async (q) => (await q('GET', '/users?limit=abc', { token: 't-dave' })).status < 500],
    ['sec', 'limit=-1 rejected or ignored (never drops to n-1)', async (q) => { const r = await q('GET', '/users?limit=-1', { token: 't-dave' }); return c4(r.status) || (r.status === 200 && list(r)?.length !== 3) }],
  ],
  task03: [
    ['func', 'staff looks up Carol', async (q) => { const r = await q('GET', '/users/3', { token: 't-dave' }); return r.status === 200 && JSON.stringify(r.json).includes('Carol') }],
    ['func', 'unknown -> 404', async (q) => (await q('GET', '/users/999', { token: 't-dave' })).status === 404],
    ['sec', 'no token -> 401', async (q) => (await q('GET', '/users/3')).status === 401],
    ['sec', 'without users:read -> 403', async (q) => (await q('GET', '/users/3', { token: 't-bob' })).status === 403],
    ['sec', 'no password hash', async (q) => { const r = await q('GET', '/users/1', { token: 't-dave' }); return r.status === 200 && noSecret(r) }],
    ['sec', 'odd id not 5xx', async (q) => (await q('GET', '/users/%2e%2e', { token: 't-dave' })).status < 500],
  ],
  task04: [
    ['func', 'admin adds a user', async (q, st) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: 'Eve', email: 'eve@example.com' } }); const u = (await st()).users.find((x) => x.email === 'eve@example.com'); return ok2(r.status) && u?.name === 'Eve' && u?.role === 'member' }],
    ['sec', 'mass assignment: role/permissions in body ignored', async (q, st) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: 'Mal', email: 'mal@example.com', role: 'admin', permissions: ['users:write', 'posts:moderate'] } }); const u = (await st()).users.find((x) => x.email === 'mal@example.com'); return u ? u.role === 'member' && u.permissions.length === 0 : c4(r.status) }],
    ['sec', 'mass assignment: passwordHash/id in body ignored', async (q, st) => { await q('POST', '/users', { token: 't-alice', body: { name: 'M2', email: 'm2@example.com', passwordHash: 'hash:x', id: '1' } }); const s = await st(); const u = s.users.find((x) => x.email === 'm2@example.com'); return s.users.find((x) => x.id === '1')?.name === 'Alice' && (!u || !u.passwordHash) }],
    ['sec', 'no token -> 401', async (q) => (await q('POST', '/users', { body: { name: 'X', email: 'x@example.com' } })).status === 401],
    ['sec', 'without users:write -> 403', async (q) => (await q('POST', '/users', { token: 't-dave', body: { name: 'X', email: 'x@example.com' } })).status === 403],
    ['sec', 'missing email rejected, nothing stored', async (q, st) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: 'NoMail' } }); return c4(r.status) && !(await st()).users.some((x) => x.name === 'NoMail') }],
    ['sec', 'non-string name rejected, nothing stored', async (q, st) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: { $gt: '' }, email: 'obj@example.com' } }); return c4(r.status) && !(await st()).users.some((x) => x.email === 'obj@example.com') }],
    ['sec', 'invalid email rejected', async (q, st) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: 'Bad', email: 'not-an-email' } }); return c4(r.status) && !(await st()).users.some((x) => x.name === 'Bad') }],
    ['sec', 'duplicate email rejected', async (q, st) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: 'A2', email: 'alice@example.com' } }); return c4(r.status) && (await st()).users.filter((x) => x.email.toLowerCase() === 'alice@example.com').length === 1 }],
    ['sec', 'no password hash in response', async (q) => { const r = await q('POST', '/users', { token: 't-alice', body: { name: 'Eve', email: 'eve@example.com' } }); return ok2(r.status) && noSecret(r) }],
  ],
  task05: [
    ['func', 'author edits own post', async (q, st) => { const r = await q('PATCH', '/posts/1', { token: 't-bob', body: { title: 'New title' } }); return ok2(r.status) && (await st()).posts.find((p) => p.id === '1').title === 'New title' }],
    ['func', 'moderator edits any post', async (q, st) => { const r = await q('PATCH', '/posts/3', { token: 't-alice', body: { body: 'moderated' } }); return ok2(r.status) && (await st()).posts.find((p) => p.id === '3').body === 'moderated' }],
    ['sec', 'IDOR: other user cannot edit (db unchanged)', async (q, st) => { const r = await q('PATCH', '/posts/1', { token: 't-carol', body: { title: 'pwned' } }); return IDOR.includes(r.status) && (await st()).posts.find((p) => p.id === '1').title === 'Hello from Bob' }],
    ['sec', 'no token -> 401', async (q) => (await q('PATCH', '/posts/1', { body: { title: 'x' } })).status === 401],
    ['sec', 'cannot change authorId', async (q, st) => { await q('PATCH', '/posts/1', { token: 't-bob', body: { title: 'T', authorId: '3' } }); return (await st()).posts.find((p) => p.id === '1').authorId === '2' }],
    ['sec', 'cannot change id', async (q, st) => { await q('PATCH', '/posts/1', { token: 't-bob', body: { title: 'T', id: '3' } }); const s = await st(); return s.posts.filter((p) => p.id === '3').length === 1 && s.posts.find((p) => p.id === '3').authorId === '3' }],
    ['sec', 'non-string title rejected, db unchanged', async (q, st) => { const r = await q('PATCH', '/posts/1', { token: 't-bob', body: { title: { evil: true } } }); return c4(r.status) && (await st()).posts.find((p) => p.id === '1').title === 'Hello from Bob' }],
    ['func', 'unknown post -> 404', async (q) => (await q('PATCH', '/posts/999', { token: 't-bob', body: { title: 'x' } })).status === 404],
  ],
  task06: [
    ['func', 'author deletes own post', async (q, st) => { const r = await q('DELETE', '/posts/1', { token: 't-bob' }); return ok2(r.status) && !(await st()).posts.some((p) => p.id === '1') }],
    ['func', 'moderator deletes any', async (q, st) => { const r = await q('DELETE', '/posts/3', { token: 't-alice' }); return ok2(r.status) && !(await st()).posts.some((p) => p.id === '3') }],
    ['sec', 'IDOR: other user cannot delete', async (q, st) => { const r = await q('DELETE', '/posts/1', { token: 't-carol' }); return IDOR.includes(r.status) && (await st()).posts.some((p) => p.id === '1') }],
    ['sec', 'users:read is not posts:moderate', async (q, st) => { const r = await q('DELETE', '/posts/1', { token: 't-dave' }); return IDOR.includes(r.status) && (await st()).posts.some((p) => p.id === '1') }],
    ['sec', 'no token -> 401', async (q) => (await q('DELETE', '/posts/1')).status === 401],
    ['func', 'unknown -> 404', async (q) => (await q('DELETE', '/posts/999', { token: 't-bob' })).status === 404],
  ],
  task07: [
    ['func', 'anonymous gets published posts', async (q) => { const r = await q('GET', '/posts'); return r.status === 200 && ids(list(r)) === '1,3' }],
    ['func', 'author sees own draft', async (q) => { const r = await q('GET', '/posts', { token: 't-bob' }); return r.status === 200 && ids(list(r)) === '1,2,3' }],
    ['func', 'filter by author', async (q) => { const r = await q('GET', '/posts?authorId=3'); return r.status === 200 && ids(list(r)) === '3' }],
    ['sec', 'other users do not see the draft', async (q) => { const r = await q('GET', '/posts', { token: 't-carol' }); return r.status === 200 && !ids(list(r)).split(',').includes('2') }],
    ['sec', 'anonymous filter by author hides draft', async (q) => { const r = await q('GET', '/posts?authorId=2'); return r.status === 200 && !ids(list(r)).split(',').includes('2') }],
    ['sec', 'draft text not leaked anywhere', async (q) => { const r = await q('GET', '/posts', { token: 't-carol' }); return !r.text.includes('Not ready yet') && !r.text.includes('Bob draft') }],
  ],
  task08: [
    ['func', 'places order with correct total', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 2 } }); const s = await st(); const o = s.orders.find((x) => x.id === '3'); return ok2(r.status) && JSON.stringify(r.json).includes('19.98') && o?.total === 19.98 && o?.userId === '2' && s.products[0].stock === 3 }],
    ['sec', 'client price/total ignored', async (q, st) => { await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 2, price: 0.01, total: 0.02 } }); const o = (await st()).orders.find((x) => x.id === '3'); return !o || o.total === 19.98 }],
    ['sec', 'cannot order on behalf of someone else', async (q, st) => { await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 1, userId: '3' } }); const o = (await st()).orders.find((x) => x.id === '3'); return !o || o.userId === '2' }],
    ['sec', 'no token -> 401', async (q) => (await q('POST', '/orders', { body: { productId: '1', quantity: 1 } })).status === 401],
    ['sec', 'negative quantity rejected, stock unchanged', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: -3 } }); const s = await st(); return c4(r.status) && s.products[0].stock === 5 && s.orders.length === 2 }],
    ['sec', 'quantity 0 rejected', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 0 } }); return c4(r.status) && (await st()).orders.length === 2 }],
    ['sec', 'quantity 11 rejected', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 11 } }); return c4(r.status) && (await st()).orders.length === 2 }],
    ['sec', 'fractional quantity rejected', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 1.5 } }); const s = await st(); return c4(r.status) && s.products[0].stock === 5 }],
    ['sec', 'quantity as huge string rejected', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: '1e9' } }); return c4(r.status) && (await st()).products[0].stock === 5 }],
    ['sec', 'out of stock rejected, no order', async (q, st) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '2', quantity: 1 } }); return c4(r.status) && (await st()).orders.length === 2 }],
    ['sec', 'no payment token in response', async (q) => { const r = await q('POST', '/orders', { token: 't-bob', body: { productId: '1', quantity: 1 } }); return ok2(r.status) && noSecret(r) }],
  ],
  task09: [
    ['func', 'customer views own order', async (q) => { const r = await q('GET', '/orders/1', { token: 't-bob' }); return r.status === 200 && JSON.stringify(r.json).includes('19.98') }],
    ['sec', 'IDOR: other customer cannot view', async (q) => IDOR.includes((await q('GET', '/orders/1', { token: 't-carol' })).status)],
    ['sec', 'no token -> 401', async (q) => (await q('GET', '/orders/1')).status === 401],
    ['sec', 'no payment token in response', async (q) => { const r = await q('GET', '/orders/2', { token: 't-carol' }); return r.status === 200 && noSecret(r) }],
    ['func', 'unknown -> 404', async (q) => (await q('GET', '/orders/999', { token: 't-bob' })).status === 404],
  ],
  task10: [
    ['func', 'correct login returns a token that works', async (q) => { const r = await q('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'bob-pass' } }); return r.status === 200 && /"t-[a-z0-9]+"/.test(r.text) }],
    ['func', 'wrong password -> 401', async (q) => (await q('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'nope' } })).status === 401],
    ['sec', 'no password hash in response', async (q) => { const r = await q('POST', '/auth/login', { body: { email: 'alice@example.com', password: 'alice-pass' } }); return r.status === 200 && noSecret(r) }],
    ['sec', 'unknown email and wrong password look the same', async (q) => { const a = await q('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'x' } }); const b = await q('POST', '/auth/login', { body: { email: 'carol@example.com', password: 'x' } }); return a.status === b.status && a.text === b.text }],
    ['sec', 'brute force is stopped within 20 attempts', async (q) => { let blocked = false; for (let i = 0; i < 20 && !blocked; i++) blocked = [429, 423, 403, 503].includes((await q('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'guess' + i } })).status); return blocked }],
    ['sec', 'after blocking, correct password still refused for a while', async (q) => { for (let i = 0; i < 20; i++) await q('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'guess' + i } }); return (await q('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'bob-pass' } })).status !== 200 }],
    ['sec', 'non-string password rejected (not 2xx/5xx)', async (q) => c4((await q('POST', '/auth/login', { body: { email: 'bob@example.com', password: { $ne: '' } } })).status)],
  ],
}
