// `node --import pangol/register src/server.ts`: run a TypeScript app on Node 22.18+ (type stripping)
// with the usual "./x.js" imports of "./x.ts" files. Bun needs nothing.
import { enableTypeScriptImports } from './cli/load.js'

enableTypeScriptImports()
