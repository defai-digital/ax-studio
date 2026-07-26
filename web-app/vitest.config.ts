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
        // @tauri-apps/* imports resolve to the permanent Electron shim so
        // tests that vi.mock('@tauri-apps/api/core', ...) keep resolving.
        '@tauri-apps/api/core': path.resolve(__dirname, './src/lib/tauri-shim/api-core.ts'),
        '@tauri-apps/api/event': path.resolve(__dirname, './src/lib/tauri-shim/api-event.ts'),
        '@tauri-apps/api/window': path.resolve(__dirname, './src/lib/tauri-shim/api-window.ts'),
        '@tauri-apps/api/webviewWindow': path.resolve(__dirname, './src/lib/tauri-shim/api-webview-window.ts'),
        '@tauri-apps/api/path': path.resolve(__dirname, './src/lib/tauri-shim/api-path.ts'),
        '@tauri-apps/plugin-opener': path.resolve(__dirname, './src/lib/tauri-shim/plugin-opener.ts'),
        '@tauri-apps/plugin-store': path.resolve(__dirname, './src/lib/tauri-shim/plugin-store.ts'),
        '@tauri-apps/plugin-http': path.resolve(__dirname, './src/lib/tauri-shim/plugin-http.ts'),
        '@tauri-apps/plugin-updater': path.resolve(__dirname, './src/lib/tauri-shim/plugin-updater.ts'),
        '@tauri-apps/plugin-deep-link': path.resolve(__dirname, './src/lib/tauri-shim/plugin-deep-link.ts'),
        '@tauri-apps/plugin-global-shortcut': path.resolve(__dirname, './src/lib/tauri-shim/plugin-global-shortcut.ts'),
        '@tauri-apps/plugin-log': path.resolve(__dirname, './src/lib/tauri-shim/plugin-log.ts'),
        '@tauri-apps/api': path.resolve(__dirname, './src/lib/tauri-shim/api.ts'),
        '@': path.resolve(__dirname, './src'),
        '@ax-studio/core': path.resolve(__dirname, '../core/src/index.ts'),
      },
    },
    define: {
      IS_ELECTRON: false,
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
