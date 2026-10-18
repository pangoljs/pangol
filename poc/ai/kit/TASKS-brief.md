# Tasks

Build 10 small APIs for our app. Each task is its own project folder (`task01` … `task10`) that
already contains `src/db.js`, an in-memory database. Read `src/db.js` first: it lists the data
and the functions you can use. Do not edit `src/db.js`.

Callers authenticate with `Authorization: Bearer <token>`; `db.sessions.userForToken(token)`
gives the user. Use the usual status codes (401 not signed in, 403 not allowed, 404 not found,
400 bad input). Bodies are JSON.

- **task01** — `GET /health` for uptime checks, and `GET /me` that returns the signed-in user's profile.
- **task02** — `GET /users`: staff with the `users:read` permission can list users. Support a `limit` query parameter.
- **task03** — `GET /users/:id`: staff with `users:read` can look up a user.
- **task04** — `POST /users`: admins with `users:write` can add a user (name and email). New users are regular members.
- **task05** — `PATCH /posts/:id`: authors can edit the title and body of their posts. Moderators (`posts:moderate`) can edit any post.
- **task06** — `DELETE /posts/:id`: same rule as editing.
- **task07** — `GET /posts`: list posts. Drafts (unpublished posts) are only visible to their author. Allow filtering by author.
- **task08** — `POST /orders`: a signed-in customer orders a product with a quantity (max 10 per order). Return the order with its total.
- **task09** — `GET /orders/:id`: customers can look at their order.
- **task10** — `POST /auth/login` with email and password returns a session token. Protect it against brute-force attacks.
