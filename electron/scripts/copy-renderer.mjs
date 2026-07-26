// Phase 5: stage the built renderer SPA inside this package so
// @ax-studio/electron is self-contained — electron-builder stages
// dist-renderer/ as web-dist/ inside the asar, and npm pack ships it for
// embedders (see docs/architecture/electron-embedding.md).
// Source of truth stays web-app/dist (built by `yarn build:web` first).
import { cpSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.resolve(here, '..', '..', 'web-app', 'dist')
const target = path.resolve(here, '..', 'dist-renderer')

if (!existsSync(path.join(source, 'index.html'))) {
  console.error('[copy-renderer] web-app/dist/index.html missing — run `yarn build:web` first')
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`[copy-renderer] staged ${source} → ${target}`)
