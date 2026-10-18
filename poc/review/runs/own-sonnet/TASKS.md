# Tasks

Build 10 small APIs for our app. Each task is its own project folder (`task01` … `task10`) that
already contains `src/db.js`, an in-memory database. Read `src/db.js` first: it lists the data
and the functions you can use. Do not edit `src/db.js`.

Callers authenticate with `Authorization: Bearer <token>`; `db.sessions.userForToken(token)`
gives the user. Use the usual status codes (401 not signed in, 403 not allowed, 404 not found,
400 bad input). Bodies are JSON.

- **task05** — `PATCH /posts/:id`: authors can edit the title and body of their posts. Moderators (`posts:moderate`) can edit any post.
- **task06** — `DELETE /posts/:id`: same rule as editing.
- **task07** — `GET /posts`: list posts. Drafts (unpublished posts) are only visible to their author. Allow filtering by author.
- **task08** — `POST /orders`: a signed-in customer orders a product with a quantity (max 10 per order). Return the order with its total.
- **task09** — `GET /orders/:id`: customers can look at their order.
