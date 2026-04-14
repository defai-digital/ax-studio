import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
    coverage: {
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/test/**/*',
        'public/vendor/**',
      ],
      thresholds: {
        // Global safety-net thresholds — per-module gates are in scripts/testing/module-thresholds.json
        lines: 30,
        functions: 30,
        branches: 20,
        statements: 30,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ax-studio/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  define: {
    IS_TAURI: JSON.stringify('false'),
    IS_WEB_APP: JSON.stringify('false'),
    IS_MACOS: JSON.stringify('false'),
    IS_WINDOWS: JSON.stringify('false'),
    PLATFORM: JSON.stringify('web'),
    VERSION: JSON.stringify('test'),
    AUTO_UPDATER_DISABLED: JSON.stringify('false'),
  },
})
