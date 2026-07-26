// The preload must be CommonJS (Electron sandboxed/ESM preload constraints),
// but the package is "type": "module", so dist-preload gets its own manifest.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '..', 'dist-preload')
mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }))
