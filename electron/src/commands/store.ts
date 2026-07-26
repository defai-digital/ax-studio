// JSON-file backed store (tauri-plugin-store equivalent). Each store is a
// flat JSON object persisted under userData/stores/.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { str } from './args.js'
import type { CommandHandler } from './registry.js'

type Args = Record<string, unknown>

function storeFilePath(name: string): string {
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(app.getPath('userData'), 'stores', safeName)
}

export function createStoreHandlers(): Record<string, CommandHandler> {
  return {
    plugin_store_load: (args) => {
      const name = str(args?.name)
      if (!name) throw new Error('plugin_store_load error: Invalid argument')
      try {
        return JSON.parse(fs.readFileSync(storeFilePath(name), 'utf8'))
      } catch {
        return {}
      }
    },

    plugin_store_save: (args) => {
      const name = str(args?.name)
      const data = args?.data
      if (!name || typeof data !== 'object' || data === null) {
        throw new Error('plugin_store_save error: Invalid argument')
      }
      const file = storeFilePath(name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      fs.writeFileSync(temp, JSON.stringify(data, null, 2))
      fs.renameSync(temp, file)
    },
  }
}
