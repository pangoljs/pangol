import { app } from './hono-app.mjs'
Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: app.fetch })
