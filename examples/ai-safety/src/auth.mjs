import { defineAuth } from 'pangol'

// Test fixture only. These strings are NOT real access tokens. No server is started.
export default defineAuth({
  from: 'bearer',
  resolve: ({ credential }) => ['alice', 'bob'].includes(credential)
    ? { id: credential, permissions: [] } : null,
})
