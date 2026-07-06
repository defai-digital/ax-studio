import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['guest-js/**/*.test.ts'],
    exclude: ['node_modules/', 'dist-js/', 'coverage'],
  },
})
