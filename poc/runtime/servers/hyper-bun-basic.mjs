import { serve } from '../dist-basic/bun.mjs'
serve(Number(process.env.PORT ?? 3000))
