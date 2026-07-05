import { defineConfig, mergeConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// Use mergeConfig to avoid the duplicate-vite type mismatch between
// the top-level vite (used by @vitejs/plugin-react) and vitest's
// bundled vite copy. The inline object is not type-checked against
// vitest's stricter PluginOption, so the react() plugin types resolve
// cleanly.
export default mergeConfig(
  {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@ax-studio/core': path.resolve(__dirname, '../core/src/index.ts'),
      },
    },
    define: {
      IS_TAURI: false,
      IS_WEB_APP: false,
      IS_MACOS: false,
      IS_WINDOWS: false,
      PLATFORM: JSON.stringify('web'),
      VERSION: JSON.stringify('test'),
      AUTO_UPDATER_DISABLED: false,
    },
  },
  defineConfig({
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
          // Global safety-net thresholds - per-module gates are in scripts/testing/module-thresholds.json
          lines: 30,
          functions: 30,
          branches: 20,
          statements: 30,
        },
      },
    },
  }),
)
