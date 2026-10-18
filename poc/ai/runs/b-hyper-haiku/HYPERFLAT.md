# hyperflat — reference for writing APIs

hyperflat is a TypeScript/JavaScript backend framework. One file = one route. Every route declares
who may call it (`auth`) and the exact shape of what goes in and out (schemas built with `t`).
The framework validates input, checks auth, and strips any field that is not in `response`
before sending. `npm run check` verifies the project and prints exact fixes.

## Project layout

```
src/
  auth.js                 # how a Bearer token becomes a user (already written)
  db.js                   # your data access
  routes/
    health.get.js         # GET  /health
    me.get.js             # GET  /me
    users/
      index.get.js        # GET  /users
      index.post.js       # POST /users
      [id].get.js         # GET  /users/:id
      [id].patch.js       # PATCH /users/:id
      [id]/posts/index.get.js  # GET /users/:id/posts
    auth/login.post.js    # POST /auth/login
```

- File name = `<name>.<method>.js`, method is `get`, `post`, `put`, `patch` or `delete`.
- `index` maps to the folder path. `[id]` is a path parameter named `id`.
- Files starting with `_` and files outside `src/routes` are not routes: put shared helpers there
  (e.g. `src/routes/users/_schemas.js` or `src/lib.js`).

## A route

```js
// src/routes/users/[id].get.js
import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: { permission: 'users:read' },
  params: t.object({ id: t.string() }),
  response: t.object({ id: t.string(), name: t.string(), email: t.email() }),
  handler: (c) => {
    const user = db.users.get(c.params.id)
    if (!user) return c.fail(404, 'user not found')
    return user // extra fields such as passwordHash are removed by `response`
  },
})
```

### Options of `route({...})`

| option | required | meaning |
|---|---|---|
| `auth` | yes | who may call the route (see below) |
| `params` | when the path has `[param]` segments | `t.object` with exactly those names |
| `query` | when the handler reads `c.query` | `t.object` of query string fields |
| `body` | when the handler reads `c.body` | `t.object` of the JSON body (POST/PUT/PATCH only) |
| `response` | yes | schema of what the client receives; undeclared fields are removed |
| `handler` | yes | `(c) => value` or `async (c) => value` |
| `rateLimit` | no | e.g. `'10/min'`, per client IP and user |

### `auth`

| value | who may call | `c.user` |
|---|---|---|
| `'public'` | anyone; the Authorization header is ignored | always `null` |
| `'optional'` | anyone; if an Authorization header is sent it must be valid (else 401) | user or `null` |
| `'user'` | signed-in users (else 401) | the user |
| `{ permission: 'users:read' }` | signed-in users whose `permissions` array contains it (else 403) | the user |

`c.user` is whatever `src/auth.js` returns for the token (here: the db user, with `id`, `role`,
`permissions`). Rules that depend on the data (e.g. "only the author may edit") are checked in the
handler: `if (post.authorId !== c.user.id) return c.fail(403, 'forbidden')`.

### The context `c`

- `c.params`, `c.query`, `c.body` — already validated; contain only the declared fields, with the
  declared types (query/params strings are converted to numbers/booleans when the schema says so).
- `c.user` — see auth. `c.ip` — client IP.
- Return a value → **200** with that value, filtered through `response`.
- `return c.created(value)` → **201**.
- `return c.noContent()` → **204**, no body (use `response: t.empty()`).
- `return c.fail(status, message)` → that status with `{ "error": message }`.
- Throwing an error → 500 (details are logged, never sent).

Invalid input never reaches the handler: the framework answers **400** (validation), **415**
(body without `Content-Type: application/json`), **401**/**403** (auth).

## Schemas: `t`

```js
t.string({ min, max, pattern })   // pattern: RegExp or string
t.email({ max })
t.int({ min, max })               // whole numbers
t.number({ min, max })
t.bool()
t.enum(['draft', 'live'])
t.array(t.string(), { min, max })
t.object({ field: t.string(), other: t.int() })
t.empty()                         // response of c.noContent()

t.int({ min: 1, max: 100 }).default(20)   // optional with a default
t.string().optional()                      // may be missing (field is then absent)
```

- Body/query/params objects keep only declared fields: sending `{ "role": "admin" }` to a route
  whose body does not declare `role` simply drops it.
- `response` may be `t.array(t.object({...}))` for lists.
- Optional fields in a response may be missing; required ones must be present with the right type,
  otherwise the request fails with 500 and a log line explaining which field is wrong.

## Checking your work

Run `npm run check` in the project folder. It loads every route and reports problems with a fix:

```
✖ src/routes/posts/[id].delete.js
  DELETE /posts/:id has no `auth`. Every route must say who may call it.
    Fix: add auth: 'user' (any signed-in user), auth: { permission: 'name' }, auth: 'optional' (user or anonymous) or auth: 'public'
```

When it passes it lists every route with its auth.

## Common patterns

```js
// list with an optional limit
export default route({
  auth: 'user',
  query: t.object({ limit: t.int({ min: 1, max: 100 }).default(20) }),
  response: t.array(t.object({ id: t.string(), title: t.string() })),
  handler: (c) => db.items.all().slice(0, c.query.limit),
})

// create
export default route({
  auth: 'user',
  body: t.object({ title: t.string({ min: 1, max: 200 }) }),
  response: t.object({ id: t.string(), title: t.string() }),
  handler: (c) => c.created(db.items.create({ title: c.body.title, ownerId: c.user.id })),
})

// owner-only update
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  body: t.object({ title: t.string({ min: 1, max: 200 }).optional() }),
  response: t.object({ id: t.string(), title: t.string() }),
  handler: (c) => {
    const item = db.items.get(c.params.id)
    if (!item) return c.fail(404, 'not found')
    if (item.ownerId !== c.user.id) return c.fail(403, 'forbidden')
    return db.items.update(item.id, c.body)
  },
})

// delete
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: t.empty(),
  handler: (c) => {
    const item = db.items.get(c.params.id)
    if (!item) return c.fail(404, 'not found')
    db.items.delete(item.id)
    return c.noContent()
  },
})
```

Module-level variables (e.g. a `Map` in a `_helpers.js` file) live as long as the server runs.
