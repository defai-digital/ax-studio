import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import viteConfig from '../../web-app/vite.config.ts'

const ENV_KEYS = [
  'IS_DEV',
  'AUTO_UPDATER_DISABLED',
  'UPDATE_CHECK_INTERVAL_MS',
]

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
})
