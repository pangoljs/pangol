import { serve } from '../dist-fullurl/bun.mjs'
serve(Number(process.env.PORT ?? 3000))
