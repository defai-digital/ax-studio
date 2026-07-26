import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

/**
 * Extension packages depend on a freshly packed core/package.tgz whose content
 * hash changes every build. CI must install the extensions workspace in
 * non-immutable mode so Yarn can update the lockfile hash after pack.
 */
describe('extensions CI install path', () => {
  it('install-and-build installs extensions with --no-immutable after packing core', () => {
    // Normalize CRLF (Windows checkout) so the recipe regex is portable.
    const makefile = read('Makefile').replace(/\r\n/g, '\n')
    const installTarget = makefile.match(
      /^install-and-build:\n((?:[ \t]+.+\n)*)/m,
    )
    expect(installTarget, 'Makefile must define install-and-build').toBeTruthy()

    const body = installTarget[1]
    expect(body).toMatch(/build:core/)
    expect(body).toMatch(
      /cd extensions && .*(install --no-immutable|YARN_ENABLE_IMMUTABLE_INSTALLS=false)/,
    )
  })

  it('extension packages declare the deps Vitest must resolve in CI', () => {
    const coreConsumers = [
      'extensions/assistant-extension/package.json',
      'extensions/conversational-extension/package.json',
      'extensions/download-extension/package.json',
      'extensions/llamacpp-extension/package.json',
    ]

    for (const pkgPath of coreConsumers) {
      const pkg = readJson(pkgPath)
      expect(
        pkg.dependencies?.['@ax-studio/core'],
        `${pkgPath} must depend on @ax-studio/core`,
      ).toMatch(/core\/package\.tgz/)
    }

    const llamacpp = readJson('extensions/llamacpp-extension/package.json')
    expect(llamacpp.dependencies?.['@ax-studio/tauri-plugin-llamacpp-api']).toMatch(
      /llamacpp-api/,
    )
    expect(readJson('extensions/llamacpp-api/package.json').name).toBe(
      '@ax-studio/tauri-plugin-llamacpp-api',
    )
  })

  it('resolves extension runtime deps from each package root after install', () => {
    const checks = [
      {
        from: 'extensions/assistant-extension/package.json',
        id: '@ax-studio/core',
      },
      {
        from: 'extensions/conversational-extension/package.json',
        id: '@ax-studio/core',
      },
      {
        from: 'extensions/download-extension/package.json',
        id: '@ax-studio/core',
      },
      {
        from: 'extensions/llamacpp-extension/package.json',
        id: '@ax-studio/core',
      },
      {
        from: 'extensions/llamacpp-extension/package.json',
        id: '@ax-studio/tauri-plugin-llamacpp-api',
      },
    ]

    for (const { from, id } of checks) {
      const require = createRequire(path.join(repoRoot, from))
      let resolved
      try {
        resolved = require.resolve(id)
      } catch (error) {
        throw new Error(
          `Failed to resolve ${id} from ${from}. Run "make install-and-build" (extensions install must use --no-immutable). Original: ${error.message}`,
        )
      }
      expect(resolved, `${id} from ${from}`).toBeTruthy()
      expect(fs.existsSync(resolved), `${resolved} must exist`).toBe(true)
    }
  })
})
