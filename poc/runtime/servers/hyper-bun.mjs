import { serve } from '../dist/bun.mjs'
serve(Number(process.env.PORT ?? 3000))
