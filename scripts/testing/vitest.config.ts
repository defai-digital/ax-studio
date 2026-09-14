import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'

const electronRequire = createRequire(
  new URL('../../electron/package.json', import.meta.url)
)

export default defineConfig({
  resolve: {
    // Test files and Electron sources must share the same mock module identity.
    alias: { electron: electronRequire.resolve('electron') },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.mjs'],
  },
})
