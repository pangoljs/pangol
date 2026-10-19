import { serve } from 'pangol/node'
import { app } from './pangol-app.mjs'
serve(app, { port: Number(process.env.PORT ?? 3000) })
