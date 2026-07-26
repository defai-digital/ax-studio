// Filesystem + dialog command handlers (Node port of
// src-tauri/src/core/filesystem/commands.rs). All paths are confined to the
// app data folder unless explicitly approved (see state.ts).
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dialog, type BrowserWindow } from 'electron'
import YAML from 'yaml'
import {
  fileContent,
  joinPathParts,
  pathPair,
  singlePath,
  str,
  stringList,
  unwrapRequest,
  writeYamlParts,
} from './args.js'
import { approvePath, resolveDataPath } from '../state.js'
import type { CommandHandler } from './registry.js'

const execFileAsync = promisify(execFile)

type Args = Record<string, unknown>

function resolve(input: string, command: string): string {
  return resolveDataPath(input, command)
}

async function writeAtomically(target: string, data: string | Buffer): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.tmp-${process.pid}`
  await fsp.writeFile(temp, data)
  await fsp.rename(temp, target)
}

interface DialogFilter {
  name: string
  extensions: string[]
}

interface DialogOpenOptions {
  multiple?: boolean
  directory?: boolean
  defaultPath?: string
  filters?: DialogFilter[]
}

function dialogOptions(args: Args | undefined): DialogOpenOptions {
  const req = unwrapRequest(args)
  const options = (req.options ?? req) as DialogOpenOptions
  return typeof options === 'object' && options !== null ? options : {}
}

export function createFsHandlers(getMainWindow: () => BrowserWindow | null): Record<string, CommandHandler> {
  return {
    join_path: (args) => path.join(...joinPathParts(args)),

    mkdir: async (args) => {
      await fsp.mkdir(resolve(singlePath(args, 'mkdir'), 'mkdir'), { recursive: true })
    },

    exists_sync: async (args) => {
      try {
        await fsp.access(resolve(singlePath(args, 'exists_sync'), 'exists_sync'))
        return true
      } catch {
        return false
      }
    },

    readdir_sync: async (args) => {
      const entries = await fsp.readdir(resolve(singlePath(args, 'readdir_sync'), 'readdir_sync'))
      return entries
    },

    read_file_sync: async (args) => {
      return fsp.readFile(resolve(singlePath(args, 'read_file_sync'), 'read_file_sync'), 'utf8')
    },

    read_file_base64: async (args) => {
      const buffer = await fsp.readFile(
        resolve(singlePath(args, 'read_file_base64'), 'read_file_base64')
      )
      return buffer.toString('base64')
    },

    rm: async (args) => {
      await fsp.rm(resolve(singlePath(args, 'rm'), 'rm'), { recursive: true, force: true })
    },

    mv: async (args) => {
      const [source, destination] = pathPair(args, 'mv')
      await fsp.rename(resolve(source, 'mv'), resolve(destination, 'mv'))
    },

    copy_file: async (args) => {
      const [source, destination] = pathPair(args, 'copy_file')
      const src = resolve(source, 'copy_file')
      const dst = resolve(destination, 'copy_file')
      const stat = await fsp.stat(src)
      if (stat.isDirectory()) {
        await fsp.cp(src, dst, { recursive: true })
      } else {
        await fsp.mkdir(path.dirname(dst), { recursive: true })
        await fsp.copyFile(src, dst)
      }
    },

    file_stat: async (args) => {
      const stat = await fsp.stat(resolve(singlePath(args, 'file_stat'), 'file_stat'))
      // Matches the Rust FileStat camelCase serialization.
      return { isDirectory: stat.isDirectory(), size: stat.size }
    },

    write_file_sync: async (args) => {
      const [target, content] = pathPair(args, 'write_file_sync')
      await writeAtomically(resolve(target, 'write_file_sync'), content)
    },

    write_blob: async (args) => {
      const [target, data] = fileContent(args, 'write_blob')
      // Rust writes `data.as_bytes()` — the string's UTF-8 bytes, NOT base64
      // (src-tauri/src/core/filesystem/commands.rs write_blob).
      await writeAtomically(resolve(target, 'write_blob'), data)
    },

    unlink_sync: async (args) => {
      await fsp.unlink(resolve(singlePath(args, 'unlink_sync'), 'unlink_sync'))
    },

    append_file_sync: async (args) => {
      const [target, content] = fileContent(args, 'append_file_sync')
      await fsp.appendFile(resolve(target, 'append_file_sync'), content, 'utf8')
    },

    write_binary_file: async (args) => {
      const target = str(args?.path)
      const base64 = str(args?.base64Data) ?? str(args?.base64_data)
      if (!target || !base64) throw new Error('write_binary_file error: Invalid argument')
      await writeAtomically(resolve(target, 'write_binary_file'), Buffer.from(base64, 'base64'))
    },

    write_text_file: async (args) => {
      const target = str(args?.path)
      const content = args?.content
      if (!target || typeof content !== 'string') {
        throw new Error('write_text_file error: Invalid argument')
      }
      await writeAtomically(resolve(target, 'write_text_file'), content)
    },

    validate_sha256: async (args) => {
      const target = str(args?.path)
      const expected = str(args?.expected)
      if (!target || !expected) throw new Error('validate_sha256 error: Invalid argument')
      const resolved = resolve(target, 'validate_sha256')
      const hash = createHash('sha256')
      await new Promise<void>((resolvePromise, rejectPromise) => {
        fs.createReadStream(resolved)
          .on('data', (chunk) => hash.update(chunk))
          .on('end', () => resolvePromise())
          .on('error', rejectPromise)
      })
      return hash.digest('hex') === expected.toLowerCase()
    },

    read_yaml: async (args) => {
      const resolved = resolve(singlePath(args, 'read_yaml'), 'read_yaml')
      const content = await fsp.readFile(resolved, 'utf8')
      return YAML.parse(content)
    },

    write_yaml: async (args) => {
      const [data, target] = writeYamlParts(args)
      // Validate it parses before writing, mirroring the Rust handler.
      YAML.parse(data)
      await writeAtomically(resolve(target, 'write_yaml'), data)
    },

    get_gguf_files: async (args) => {
      const paths = stringList(args, 'get_gguf_files')
      const gguf: string[] = []
      const nonGguf: string[] = []

      const scan = async (resolved: string, display: string): Promise<void> => {
        const stat = await fsp.stat(resolved).catch(() => null)
        if (!stat) {
          nonGguf.push(display)
          return
        }
        if (stat.isDirectory()) {
          // Recursive *.gguf scan (Electron-side behavior; the Rust handler
          // only classified explicit file paths).
          const entries = await fsp.readdir(resolved, { withFileTypes: true })
          for (const entry of entries) {
            await scan(path.join(resolved, entry.name), path.join(display, entry.name))
          }
          return
        }
        if (isGgufPath(display)) gguf.push(display)
        else nonGguf.push(display)
      }

      for (const p of paths) {
        const resolved = resolve(p, 'get_gguf_files')
        await scan(resolved, resolved)
      }
      return { gguf, non_gguf: nonGguf }
    },

    decompress: async (args) => {
      const req = unwrapRequest(args)
      const archive = str(req.path)
      const outputDir = str(req.outputDir) ?? str(req.output_dir)
      if (!archive || !outputDir) throw new Error('decompress error: Invalid argument')
      const resolvedArchive = resolve(archive, 'decompress')
      const resolvedOutput = resolve(outputDir, 'decompress')
      await fsp.mkdir(resolvedOutput, { recursive: true })

      const lower = resolvedArchive.toLowerCase()
      if (lower.endsWith('.zip')) {
        const unzipper = await import('unzipper')
        await new Promise<void>((resolvePromise, rejectPromise) => {
          fs.createReadStream(resolvedArchive)
            .pipe(unzipper.Extract({ path: resolvedOutput }))
            .on('close', () => resolvePromise())
            .on('error', rejectPromise)
        })
      } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
        await execFileAsync('tar', ['-xf', resolvedArchive, '-C', resolvedOutput])
      } else {
        throw new Error(`decompress: unsupported archive format: ${resolvedArchive}`)
      }
    },

    open_dialog: async (args) => {
      const win = getMainWindow()
      if (!win) throw new Error('open_dialog: no window available')
      const options = dialogOptions(args)
      const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = []
      if (options.directory) properties.push('openDirectory')
      else properties.push('openFile')
      if (options.multiple) properties.push('multiSelections')

      const result = await dialog.showOpenDialog(win, {
        properties,
        defaultPath: options.defaultPath,
        filters: options.filters,
      })
      if (result.canceled || result.filePaths.length === 0) return null
      for (const p of result.filePaths) approvePath(p)
      if (options.multiple) return result.filePaths
      return result.filePaths[0]
    },

    save_dialog: async (args) => {
      const win = getMainWindow()
      if (!win) throw new Error('save_dialog: no window available')
      const options = dialogOptions(args)
      const result = await dialog.showSaveDialog(win, {
        defaultPath: options.defaultPath,
        filters: options.filters,
      })
      if (result.canceled || !result.filePath) return null
      approvePath(result.filePath)
      return result.filePath
    },
  }
}

function isGgufPath(p: string): boolean {
  return path.extname(p).toLowerCase() === '.gguf'
}
