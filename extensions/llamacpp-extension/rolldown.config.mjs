import { defineConfig } from 'rolldown'
import path from 'path'
import { fileURLToPath } from 'url'
import pkgJson from './package.json' with { type: 'json' }
import settingJson from './settings.json' with { type: 'json' }

const dirname = path.dirname(fileURLToPath(import.meta.url))
// @tauri-apps/* imports resolve to the web-app Electron shim (the real npm
// packages were removed in the Electron migration).
const shim = (name) => path.resolve(dirname, '../../web-app/src/lib/tauri-shim', name)

export default defineConfig({
  input: 'src/index.ts',
  output: {
    format: 'esm',
    file: 'dist/index.js',
  },
  platform: 'browser',
  resolve: {
    alias: {
      '@tauri-apps/api/core': shim('api-core.ts'),
      '@tauri-apps/api/event': shim('api-event.ts'),
      '@tauri-apps/plugin-http': shim('plugin-http.ts'),
    },
  },
  define: {
    SETTINGS: JSON.stringify(settingJson),
    ENGINE: JSON.stringify(pkgJson.engine),
    IS_WINDOWS: JSON.stringify(process.platform === 'win32'),
    IS_MACOS: JSON.stringify(process.platform === 'darwin'),
    IS_LINUX: JSON.stringify(process.platform === 'linux'),
  },
  inject: process.env.IS_DEV ? {} : {
    fetch: [shim('plugin-http.ts'), 'fetch'],
  },
})
