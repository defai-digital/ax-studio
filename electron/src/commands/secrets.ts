// Secret storage backed by Electron safeStorage (macOS Keychain / Windows
// DPAPI / Linux libsecret), persisted as a JSON map in userData.
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { str } from './args.js'
import type { CommandHandler } from './registry.js'

type Args = Record<string, unknown>

function secretsFilePath(): string {
  return path.join(app.getPath('userData'), 'secrets.json')
}

function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(secretsFilePath(), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

function writeSecrets(secrets: Record<string, string>): void {
  const file = secretsFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify(secrets), { mode: 0o600 })
  fs.renameSync(temp, file)
}

function encrypt(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(value).toString('base64')}`
  }
  // No OS keychain available (some Linux sessions). Stored obfuscated only —
  // same trade-off the Tauri keyring fallback makes; logged loudly.
  console.warn('[electron] safeStorage encryption unavailable; storing secret obfuscated')
  return `plain:${Buffer.from(value, 'utf8').toString('base64')}`
}

function decrypt(stored: string): string {
  if (stored.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  }
  return stored
}

export function createSecretsHandlers(): Record<string, CommandHandler> {
  return {
    get_secret: (args) => {
      const key = str(args?.key)
      if (!key) throw new Error('get_secret error: Invalid argument')
      const stored = readSecrets()[key]
      return stored === undefined ? null : decrypt(stored)
    },

    set_secret: (args) => {
      const key = str(args?.key)
      const value = args?.value
      if (!key || typeof value !== 'string') {
        throw new Error('set_secret error: Invalid argument')
      }
      const secrets = readSecrets()
      secrets[key] = encrypt(value)
      writeSecrets(secrets)
    },

    delete_secret: (args) => {
      const key = str(args?.key)
      if (!key) throw new Error('delete_secret error: Invalid argument')
      const secrets = readSecrets()
      delete secrets[key]
      writeSecrets(secrets)
    },
  }
}
