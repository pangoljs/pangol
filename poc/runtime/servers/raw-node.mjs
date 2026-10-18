import http from 'node:http'
const body = '{"ok":true}'
http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body) }).listen(Number(process.env.PORT ?? 3000))
