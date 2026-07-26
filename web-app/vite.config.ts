import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import packageJson from './package.json'

// Electron is the only desktop runtime: every @tauri-apps/* import resolves to
// the permanent shim in src/lib/tauri-shim, which talks to the Electron main
// process over the preload IPC bridge (`window.axElectron`).
// See docs/architecture/electron-migration-phase0-matrix.md.
const electronShimAliases: Record<string, string> = {
  // Exact subpath matches must precede the bare '@tauri-apps/api' entry.
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
}

const readBooleanEnv = (name: string): boolean => process.env[name] === 'true'

// The three built-in extensions are bundled statically from source (no tgz,
// no extensions.json). Their sources expect rolldown-style build-time
// constants — see each extension's rolldown.config.mjs. A global vite `define`
// cannot work here: llamacpp-extension and download-extension both use the
// bare identifier `SETTINGS` but with different values, so the replacement is
// applied per-module instead.
const extensionBuildConstants = (): Plugin => {
  const perPackage: Array<{ dir: string; constants: Record<string, string> }> = [
    {
      dir: path.resolve(__dirname, '../extensions/llamacpp-extension/src'),
      constants: {
        SETTINGS: fs.readFileSync(
          path.resolve(__dirname, '../extensions/llamacpp-extension/settings.json'),
          'utf8'
        ).trim(),
        ENGINE: JSON.stringify('llamacpp'),
      },
    },
    {
      dir: path.resolve(__dirname, '../extensions/download-extension/src'),
      constants: {
        SETTINGS: fs.readFileSync(
          path.resolve(__dirname, '../extensions/download-extension/settings.json'),
          'utf8'
        ).trim(),
      },
    },
  ]
  return {
    name: 'ax-studio-extension-build-constants',
    enforce: 'pre',
    transform(code, id) {
      const pkg = perPackage.find((entry) => id.startsWith(entry.dir + path.sep))
      if (!pkg) return null
      let transformed = code
      for (const [identifier, replacement] of Object.entries(pkg.constants)) {
        transformed = transformed.replace(
          new RegExp(`\\b${identifier}\\b`, 'g'),
          replacement
        )
      }
      return transformed === code ? null : { code: transformed, map: null }
    },
  }
}

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
    // Packaged Electron loads the SPA via loadFile, so asset URLs must be
    // relative.
    base: './',
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      extensionBuildConstants(),
    ],
    resolve: {
      alias: {
        ...electronShimAliases,
        // token.js imports mime-types in the renderer. mime-types requires
        // Node's path.extname, which Vite otherwise externalizes to an empty
        // browser proxy and breaks URL-based image MIME detection.
        path: 'path-browserify',
        '@': path.resolve(__dirname, './src'),
        '@ax-studio/core': path.resolve(__dirname, '../core/src/index.ts'),
        '@ax-studio/conversational-extension': path.resolve(__dirname, '../extensions/conversational-extension/src/index.ts'),
        '@ax-studio/download-extension': path.resolve(__dirname, '../extensions/download-extension/src/index.ts'),
        '@ax-studio/llamacpp-extension': path.resolve(__dirname, '../extensions/llamacpp-extension/src/index.ts'),
        '@ax-studio/tauri-plugin-llamacpp-api': path.resolve(__dirname, '../extensions/llamacpp-api/index.ts'),
      },
    },
    define: {
      IS_ELECTRON: JSON.stringify(true),
      IS_DEV: JSON.stringify(readBooleanEnv('IS_DEV')),
      IS_WEB_APP: JSON.stringify(false),
      // Host platform of the build machine; Electron packages per-platform
      // (mac build on macOS, Windows build on Windows), same as the old
      // TAURI_ENV_PLATFORM-derived constants.
      IS_MACOS: JSON.stringify(process.platform === 'darwin'),
      IS_WINDOWS: JSON.stringify(process.platform === 'win32'),
      PLATFORM: JSON.stringify(process.platform),

      VERSION: JSON.stringify(packageJson.version),

      AUTO_UPDATER_DISABLED: JSON.stringify(
        readBooleanEnv('AUTO_UPDATER_DISABLED')
      ),
      UPDATE_CHECK_INTERVAL_MS: JSON.stringify(
        readPositiveNumberEnv('UPDATE_CHECK_INTERVAL_MS', 60 * 60 * 1000)
      ),
    },

    clearScreen: false,
    // Fixed port so the Electron shell can wait on it. Port 31420 avoids
    // clashing with common local AI stacks (and the old Tauri template
    // default 1420). AX BI local stack owns 31421–31429.
    server: {
      port: 31420,
      strictPort: true,
      watch: {
        // Polling drains battery on macOS; enable only when forced (CI/Docker/WSL).
        usePolling:
          process.env.VITE_USE_POLLING === '1' ||
          process.env.CHOKIDAR_USEPOLLING === 'true' ||
          process.env.CI === 'true',
      },
    },
  }
})
