import { defineConfig } from 'rolldown'
import path from 'path'
import { fileURLToPath } from 'url'
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
    },
  },
  define: {
    SETTINGS: JSON.stringify(settingJson),
  },
})
