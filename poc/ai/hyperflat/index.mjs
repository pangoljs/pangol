// Public API: import { route, t, defineAuth } from 'hyperflat'
export { t } from './schema.mjs'

const ROUTE = Symbol.for('hyperflat.route')
const AUTH = Symbol.for('hyperflat.auth')

export function route(def) {
  if (def === null || typeof def !== 'object') throw new Error('route({...}) needs an object')
  return { ...def, [ROUTE]: true }
}
export function defineAuth(def) {
  if (def === null || typeof def !== 'object' || typeof def.resolve !== 'function') throw new Error('defineAuth({ resolve(token) { ... } }) needs a resolve function')
  return { ...def, [AUTH]: true }
}
export const isRoute = (x) => x !== null && typeof x === 'object' && x[ROUTE] === true
export const isAuth = (x) => x !== null && typeof x === 'object' && x[AUTH] === true
