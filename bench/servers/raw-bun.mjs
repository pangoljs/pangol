// Ceiling: the least work Bun can do for /health.
const body = '{"ok":true}'
Bun.serve({ port: Number(process.env.PORT ?? 3000), routes: { '/health': { GET: () => new Response(body, { headers: { 'content-type': 'application/json' } }) } }, fetch: () => new Response('', { status: 404 }) })
