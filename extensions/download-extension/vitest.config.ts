import { defineConfig } from 'vitest/config'
import path from 'path'

// @tauri-apps/* imports resolve to the web-app Electron shim (the real npm
// packages were removed in the Electron migration). Tests still
// vi.mock('@tauri-apps/api/core', ...) — the alias keeps those resolvable.
const shim = (name: string) =>
  path.resolve(__dirname, '../../web-app/src/lib/tauri-shim', name)

export default defineConfig({
  resolve: {
    alias: {
      '@tauri-apps/api/core': shim('api-core.ts'),
      '@tauri-apps/api/event': shim('api-event.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
    },
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/', 'dist/', 'coverage'],
  },
})
