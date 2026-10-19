import { route, t } from '../../../../../../src/index.js'

// C9: c.user is always null on a public route
export default route({
  auth: 'public',
  response: t.string(),
  // @ts-expect-error the type system catches it too; check also covers JavaScript and casts
  handler: (c) => String(c.user?.id),
})
