import { serve } from '../dist-basic/node.mjs'
serve(Number(process.env.PORT ?? 3000))
