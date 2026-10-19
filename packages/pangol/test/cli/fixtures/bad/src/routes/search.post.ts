import { route, t } from '../../../../../../src/index.js'

// C3: reads c.body without a body schema
export default route({
  auth: 'user',
  response: t.string(),
  // @ts-expect-error the type system catches it too
  handler: (c) => String(c.body),
})
