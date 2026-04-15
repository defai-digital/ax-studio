import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['path'],
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@ax-studio/core': path.resolve(__dirname, '../core/src/index.ts'),
        '@ax-studio/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/src/index.ts'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(false),
      IS_MACOS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('darwin') ?? false
      ),
      IS_WINDOWS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('windows') ?? false
      ),
      PLATFORM: JSON.stringify(process.env.TAURI_ENV_PLATFORM),

      VERSION: JSON.stringify(packageJson.version),

      AUTO_UPDATER_DISABLED: JSON.stringify(
        process.env.AUTO_UPDATER_DISABLED === 'true'
      ),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        Number(process.env.UPDATE_CHECK_INTERVAL_MS) || 60 * 60 * 1000
      ),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
        usePolling: true
      },
    },
  }
})
