// Node adapter (interpreted variant of the PoC 2 compiler, same semantics).
import http from 'node:http'
import { validTarget, safeSegment, isJson, parseJson, Reject } from './strict.mjs'
import { validate, output, ValidationError, ResponseError } from './schema.mjs'

const BODY_LIMIT = 1024 * 1024
const HEADERS = { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cache-control': 'no-store' }

class Fail { constructor(status, message) { this.status = status; this.message = message } }
class Created { constructor(value) { this.value = value } }
const NO_CONTENT = Symbol('noContent')

function send(res, status, obj) {
  if (res.headersSent) return
  if (status === 204) { res.writeHead(204, { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); return res.end() }
  res.writeHead(status, HEADERS)
  res.end(JSON.stringify(obj))
}
const fail = (res, status, error, field) => send(res, status, field ? { error, field } : { error })

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > BODY_LIMIT) { reject(new Reject(413, 'body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const WINDOWS = { s: 1e3, sec: 1e3, m: 6e4, min: 6e4, h: 36e5, hour: 36e5 }
function limiter(spec) {
  const [n, unit] = spec.split('/')
  const max = Number(n), win = WINDOWS[unit]
  const hits = new Map()
  return (key) => {
    const now = Date.now()
    let h = hits.get(key)
    if (!h || now - h.start > win) { h = { start: now, count: 0 }; hits.set(key, h) }
    return ++h.count <= max
  }
}

function match(routes, segs) {
  let best = null, bestScore = -1
  for (const r of routes) {
    if (r.segs.length !== segs.length) continue
    let score = 0, ok = true
    for (let i = 0; i < segs.length; i++) {
      if (r.segs[i].startsWith(':')) continue
      if (r.segs[i] !== segs[i]) { ok = false; break }
      score += 1 << (segs.length - i) // literal segments win over params
    }
    if (ok && score >= bestScore) {
      if (score > bestScore) best = []
      best.push(r); bestScore = score
    }
  }
  return best ?? []
}

export function createServer({ routes, auth }, { log = console.error } = {}) {
  for (const r of routes) if (r.def.rateLimit) r.limit = limiter(r.def.rateLimit)
  return http.createServer(async (req, res) => {
    try {
      const url = req.url
      if (!validTarget(url)) return fail(res, 400, 'invalid path')
      const q = url.indexOf('?')
      const p = q === -1 ? url : url.slice(0, q)
      const segs = p === '/' ? [''] : p.split('/').slice(1)
      const candidates = match(routes, segs)
      if (!candidates.length) return fail(res, 404, 'not found')
      const r = candidates.find((x) => x.method === req.method)
      if (!r) return fail(res, 405, 'method not allowed')
      const def = r.def

      // auth
      let user = null
      if (def.auth !== 'public') {
        const h = req.headers.authorization
        if (h === undefined) { if (def.auth !== 'optional') return fail(res, 401, 'unauthorized') }
        else {
          if (!h.startsWith('Bearer ') || h.length < 8) return fail(res, 401, 'unauthorized')
          user = await auth.resolve(h.slice(7))
          if (user == null) return fail(res, 401, 'unauthorized')
          if (typeof def.auth === 'object' && !(Array.isArray(user.permissions) && user.permissions.includes(def.auth.permission))) return fail(res, 403, 'forbidden')
        }
      }
      if (r.limit && !r.limit(`${req.socket.remoteAddress}|${user?.id ?? ''}`)) return fail(res, 429, 'too many requests')

      const c = {
        user,
        params: undefined, query: undefined, body: undefined,
        ip: req.socket.remoteAddress,
        fail: (status, message) => new Fail(status, message),
        created: (value) => new Created(value),
        noContent: () => NO_CONTENT,
      }
      try {
        if (def.params) {
          const raw = {}
          r.segs.forEach((s, i) => {
            if (!s.startsWith(':')) return
            let v
            try { v = decodeURIComponent(segs[i]) } catch { throw new ValidationError(s.slice(1), 'is malformed') }
            if (!safeSegment(v)) throw new ValidationError(s.slice(1), 'is invalid')
            raw[s.slice(1)] = v
          })
          c.params = validate(def.params, raw, '', true)
        }
        if (def.query) {
          const raw = Object.create(null)
          for (const [k, v] of new URLSearchParams(q === -1 ? '' : url.slice(q + 1))) {
            if (k in raw) throw new ValidationError(k, 'is repeated')
            raw[k] = v
          }
          c.query = validate(def.query, raw, '', true)
        }
        if (def.body) {
          if (!isJson(req.headers['content-type'])) return fail(res, 415, 'expected application/json')
          const text = await readBody(req)
          c.body = validate(def.body, parseJson(text), '', false)
        }
      } catch (e) {
        if (e instanceof ValidationError) return fail(res, 400, `${e.path} ${e.message}`, e.path)
        if (e instanceof Reject) return fail(res, e.status, e.code)
        throw e
      }

      const out = await def.handler(c)
      if (out instanceof Fail) return fail(res, out.status, out.message)
      if (out === NO_CONTENT) return send(res, 204)
      const status = out instanceof Created ? 201 : 200
      const value = out instanceof Created ? out.value : out
      let body
      try { body = output(def.response, value) } catch (e) {
        if (e instanceof ResponseError) {
          log(`[hyperflat] ${r.method} ${r.path} (${r.file}): handler returned a value that does not match \`response\`: ${e.path} ${e.message}`)
          return fail(res, 500, 'internal error')
        }
        throw e
      }
      return send(res, status, body)
    } catch (e) {
      log(`[hyperflat] ${req.method} ${req.url}: ${e?.stack ?? e}`)
      return fail(res, 500, 'internal error')
    }
  })
}
