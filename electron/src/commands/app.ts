// App/system command handlers (Node port of src-tauri/src/core/app and
// src-tauri/src/core/system command surfaces).
import { app, shell } from 'electron'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { logParts, singlePath, str } from './args.js'
import {
  appendLog,
  canonicalizeLoose,
  configurationFilePath,
  defaultDataFolderPath,
  getAppConfigurations,
  getAppDataFolderPath,
  readLogs,
  takePendingOpenFiles,
  updateAppConfiguration,
} from '../state.js'
import type { CommandHandler } from './registry.js'

type Args = Record<string, unknown>

export function createAppHandlers(): Record<string, CommandHandler> {
  return {
    get_app_configurations: () => getAppConfigurations(),

    get_app_data_folder_path: () => getAppDataFolderPath(),

    default_data_folder_path: () => defaultDataFolderPath(),

    // The Rust command returns the configured data folder (not $HOME) — kept
    // for bridge compatibility.
    get_user_home_path: () => getAppConfigurations().data_folder,

    get_configuration_file_path: () => configurationFilePath(),

    change_app_data_folder: async (args) => {
      const newFolder = str(args?.newDataFolder) ?? str(args?.new_data_folder)
      if (!newFolder || !path.isAbsolute(newFolder)) {
        throw new Error('change_app_data_folder error: Invalid argument')
      }
      const resolved = canonicalizeLoose(newFolder)
      // Guard against pointing the data folder at a dangerous root.
      if (resolved === path.parse(resolved).root || resolved === os.homedir()) {
        throw new Error('change_app_data_folder: refusing to use a filesystem root or home dir')
      }
      await fsp.mkdir(resolved, { recursive: true })
      updateAppConfiguration({ data_folder: resolved })
      // Phase 1 note: the Rust version also migrates existing data and kills
      // running engines; that orchestration lands with Phase 2.
    },

    relaunch: () => {
      app.relaunch()
      app.exit(0)
    },

    canonicalize_path: async (args) => {
      const target = str(args?.path)
      if (!target) throw new Error('canonicalize_path error: Invalid argument')
      return fsp.realpath(target)
    },

    dir_name: (args) => {
      const parent = path.dirname(singlePath(args, 'dir_name'))
      if (!parent) throw new Error('dir_name error: Invalid argument')
      return parent
    },

    base_name: (args) => {
      const name = path.basename(singlePath(args, 'base_name'))
      if (!name) throw new Error('base_name error: Invalid argument')
      return name
    },

    is_subdirectory: (args) => {
      const from = str(args?.from)
      const to = str(args?.to)
      if (!from || !to) throw new Error('is_subdirectory error: Invalid argument')
      const relative = path.relative(path.resolve(from), path.resolve(to))
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
    },

    log: (args) => {
      const [message, fileName] = logParts(args)
      appendLog(message, fileName)
    },

    open_file_explorer: async (args) => {
      const target = str(args?.path)
      if (!target) throw new Error('open_file_explorer error: Invalid argument')
      const resolved = canonicalizeLoose(target)
      const stat = await fsp.stat(resolved).catch(() => null)
      if (stat?.isDirectory()) {
        const openError = await shell.openPath(resolved)
        if (openError) throw new Error(`open_file_explorer: ${openError}`)
      } else {
        shell.showItemInFolder(resolved)
      }
    },

    factory_reset: async () => {
      const dataFolder = getAppDataFolderPath()
      const resolved = canonicalizeLoose(dataFolder)
      // Safety rails: never wipe a filesystem root, the home directory, or
      // anything suspiciously shallow.
      const dangerous = [path.parse(resolved).root, os.homedir(), app.getPath('appData')]
      if (dangerous.includes(resolved) || resolved.split(path.sep).filter(Boolean).length < 3) {
        throw new Error(`factory_reset: refusing to delete ${resolved}`)
      }
      await fsp.rm(resolved, { recursive: true, force: true })
      updateAppConfiguration({ data_folder: defaultDataFolderPath() })
      app.relaunch()
      app.exit(0)
    },

    read_logs: () => readLogs(),

    take_pending_open_files: () => takePendingOpenFiles(),

    open_external_url: async (args) => {
      const url = str(args?.url)
      if (!url || !/^(https?|mailto):/i.test(url)) {
        throw new Error('open_external_url error: Invalid or unsafe URL')
      }
      await shell.openExternal(url)
    },
  }
}
