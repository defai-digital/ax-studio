import { defineConfig } from 'vitest/config'

export default defineConfig({
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
