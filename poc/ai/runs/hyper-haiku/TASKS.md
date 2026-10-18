# Tasks

Build 10 small APIs. Each task is its own project folder (`task01` … `task10`) that already
contains `src/db.js`, an in-memory database. Read `src/db.js` first: it lists the data and the
functions you can use. Do not edit `src/db.js`.

## Conventions for every task

- Request and response bodies are JSON. IDs are strings.
- Callers authenticate with the header `Authorization: Bearer <token>`.
  `db.sessions.userForToken(token)` returns the user for a token (with `permissions`, an array of
  strings), or `undefined` for an unknown token.
- Missing or invalid token on a route that requires sign-in: **401**.
  Signed in but not allowed: **403**.
- Invalid input (missing field, wrong type, out of range, malformed): **400**.
- Not found: **404**. Error bodies: `{ "error": "<message>" }`.
- Responses must contain exactly the fields listed for that endpoint.

## task01 — health and current user
- `GET /health` — anyone. Returns `{ "ok": true }`.
- `GET /me` — signed-in users. Returns the caller as `{ id, name, email }`.

## task02 — list users
- `GET /users` — requires the `users:read` permission.
  Returns an array of `{ id, name, email }`.
  Optional query `limit`: whole number from 1 to 100, default 20; returns at most that many users.

## task03 — get one user
- `GET /users/:id` — requires `users:read`. Returns `{ id, name, email, role }`. Unknown id: 404.

## task04 — create a user
- `POST /users` — requires `users:write`.
  Body: `name` (string, 1–100 characters), `email` (valid email address).
  New users always get the role `"member"` and no permissions.
  If a user with that email already exists: **409**.
  Responds **201** with `{ id, name, email, role }`.

## task05 — edit a post
- `PATCH /posts/:id` — signed-in users.
  Body: `title` (string, 1–200 characters) and/or `body` (string, up to 5000 characters); at least one of them.
  Only the post's author may edit it, except users with the `posts:moderate` permission, who may edit any post.
  Unknown post: 404. Returns the updated post as `{ id, title, body, authorId }`.

## task06 — delete a post
- `DELETE /posts/:id` — signed-in users. Same permission rule as task05.
  Responds **204** with no body. Unknown post: 404.

## task07 — list posts
- `GET /posts` — anyone, signed in or not. If an `Authorization` header is sent but the token is invalid: 401.
  Returns an array of `{ id, title, authorId }` with all published posts, plus the caller's own
  unpublished posts if the caller is signed in.
  Optional query `authorId`: only posts by that author.

## task08 — place an order
- `POST /orders` — signed-in users.
  Body: `productId` (string), `quantity` (whole number from 1 to 10).
  The total is `product price × quantity`, rounded to 2 decimals.
  Unknown product: 404. Not enough stock: **409** (use `db.products.takeStock`).
  Responds **201** with `{ id, productId, quantity, total }`.

## task09 — view an order
- `GET /orders/:id` — signed-in users. Only the customer who placed the order may view it
  (nobody else, including admins). Unknown order: 404.
  Returns `{ id, productId, quantity, total }`.

## task10 — log in
- `POST /auth/login` — anyone. Body: `email` (valid email), `password` (string, 1–200 characters).
  On success: 200 with `{ token }` (use `db.sessions.create`).
  Wrong email or wrong password: **401** with exactly the same response in both cases.
  After 5 failed attempts for the same email within 15 minutes, every further attempt for that
  email (even with the right password) gets **429** until the 15 minutes have passed.
