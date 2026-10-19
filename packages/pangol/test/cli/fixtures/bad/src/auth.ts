import { defineAuth } from '../../../../../src/index.js'

export const auth = defineAuth({ from: { cookie: 'sid' }, resolve: () => ({ id: 'ada', permissions: [] }) })
