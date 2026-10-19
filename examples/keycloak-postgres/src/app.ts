import { createApp } from 'pangol'
import auth from './auth.js'
import { routes } from '../.pangol/routes.js'
export const app = createApp({ auth, routes, limits: { body: 16_384 } })
