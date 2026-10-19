import { serve } from 'pangol/bun'
import { app } from './pangol-app.mjs'
serve(app, { port: Number(process.env.PORT ?? 3000) })
