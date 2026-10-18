import { serve } from '../dist/node.mjs'
serve(Number(process.env.PORT ?? 3000))
