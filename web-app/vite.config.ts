import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

const readBooleanEnv = (name: string): boolean => process.env[name] === 'true'

const readPositiveNumberEnv = (
  name: string,
  fallbackValue: number
): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallbackValue
}

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
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@ax-studio/core': path.resolve(__dirname, '../core/src/index.ts'),
        '@ax-studio/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/src/index.ts'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(readBooleanEnv('IS_TAURI')),
      IS_DEV: JSON.stringify(readBooleanEnv('IS_DEV')),
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
        readBooleanEnv('AUTO_UPDATER_DISABLED')
      ),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        readPositiveNumberEnv('UPDATE_CHECK_INTERVAL_MS', 60 * 60 * 1000)
      ),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available.
    // Port 31420 avoids clashing with common local AI stacks (and the old
    // Tauri template default 1420). Keep in sync with:
    // - src-tauri/tauri.conf.json build.devUrl
    // - Makefile DEV_PORT
    // When HMR uses an explicit host, use 31430 for the WebSocket port.
    // AX BI local stack owns 31421–31429 (MCP, node, web, services, WS, nginx).
    server: {
      port: 31420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 31430,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
        // Polling drains battery on macOS; enable only when forced (CI/Docker/WSL).
        usePolling:
          process.env.VITE_USE_POLLING === '1' ||
          process.env.CHOKIDAR_USEPOLLING === 'true' ||
          process.env.CI === 'true',
      },
    },
  }
})
