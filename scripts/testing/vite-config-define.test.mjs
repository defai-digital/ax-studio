import fs from 'fs'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import viteConfig from '../../web-app/vite.config.ts'

const ENV_KEYS = ['IS_DEV', 'AUTO_UPDATER_DISABLED', 'UPDATE_CHECK_INTERVAL_MS']

const originalEnv = new Map()

async function resolveConfig() {
  const config =
    typeof viteConfig === 'function'
      ? viteConfig({ command: 'serve', mode: 'development' })
      : viteConfig

  return Promise.resolve(config)
}

describe('web-app vite config defines', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    originalEnv.clear()
  })

  it('serializes boolean env defines as boolean literals', async () => {
    process.env.IS_DEV = 'true'
    process.env.AUTO_UPDATER_DISABLED = 'false'

    const config = await resolveConfig()

    expect(config.define?.IS_DEV).toBe('true')
    expect(config.define?.AUTO_UPDATER_DISABLED).toBe('false')
    // Electron is the only runtime: IS_ELECTRON is always on, IS_TAURI is gone.
    expect(config.define?.IS_ELECTRON).toBe('true')
    expect(config.define?.IS_TAURI).toBeUndefined()
  })

  it('uses the fixed AX Studio Vite dev port (kept in sync with Makefile DEV_PORT)', async () => {
    const config = await resolveConfig()

    expect(config.server?.port).toBe(31420)
    expect(config.server?.strictPort).toBe(true)
  })

  it('polyfills Node path for browser-only token.js MIME detection', async () => {
    const config = await resolveConfig()

    expect(config.resolve?.alias?.path).toBe('path-browserify')
  })

  it('falls back to the default update check interval for invalid values', async () => {
    process.env.UPDATE_CHECK_INTERVAL_MS = '-1'

    const config = await resolveConfig()

    expect(config.define?.UPDATE_CHECK_INTERVAL_MS).toBe('3600000')
  })

  it('uses a positive custom update check interval', async () => {
    process.env.UPDATE_CHECK_INTERVAL_MS = '120000'

    const config = await resolveConfig()

    expect(config.define?.UPDATE_CHECK_INTERVAL_MS).toBe('120000')
  })

  it('injects extension build constants for POSIX-style module ids on Windows', async () => {
    const config = await resolveConfig()
    const plugin = config.plugins
      ?.flat()
      .find(
        (p) =>
          p &&
          typeof p === 'object' &&
          p.name === 'ax-studio-extension-build-constants'
      )
    expect(plugin).toBeDefined()
    expect(typeof plugin.transform).toBe('function')

    // Vite normalizes module ids to POSIX separators on every platform;
    // the plugin's per-package dirs come from path.resolve and are
    // backslash-separated on Windows.
    const settingsJson = fs
      .readFileSync(
        path.resolve(
          __dirname,
          '../../extensions/llamacpp-extension/settings.json'
        ),
        'utf8'
      )
      .trim()
    const moduleDir = path
      .resolve(__dirname, '../../extensions/llamacpp-extension/src')
      .split(path.sep)
      .join('/')
    const posixId = `${moduleDir}/index.ts`

    const result = await plugin.transform(
      'const rawSettings = SETTINGS',
      posixId
    )

    expect(result).not.toBeNull()
    expect(result.code).toContain(settingsJson)
    expect(result.code).not.toMatch(/\bSETTINGS\b/)
  })
})
