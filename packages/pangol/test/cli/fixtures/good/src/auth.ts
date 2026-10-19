import { defineAuth } from '../../../../../src/index.js'

export default defineAuth({ from: 'bearer', resolve: (req) => (req.credential === 'ada' ? { id: 'ada', permissions: ['admin'] } : null) })
