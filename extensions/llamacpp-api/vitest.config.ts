import { defineConfig } from 'vitest/config'
import path from 'path'

// tauri/* imports resolve to the web-app Electron shim (the real npm
// packages were removed in the Electron migration).
const shim = (name: string) =>
  path.resolve(__dirname, '../../web-app/src/lib/tauri-shim', name)

export default defineConfig({
  resolve: {
    alias: {
      '../../web-app/src/lib/tauri-shim/api-core': shim('api-core.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['*.test.ts'],
    exclude: ['node_modules/', 'coverage'],
  },
})
