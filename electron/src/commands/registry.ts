// IPC command registry: maps Tauri command names to main-process handlers and
// wires the `ax:invoke` / `ax:event-emit` channels from the preload bridge.
import { ipcMain, BrowserWindow } from 'electron'
import { createAppHandlers } from './app.js'
import { createAxBiHandlers } from './ax-bi.js'
import { createAxEngineHandlers } from './ax-engine.js'
import { createDownloadHandlers } from './downloads.js'
import { createFsHandlers } from './fs.js'
import { createHardwareHandlers } from './hardware.js'
import { createLlamacppHandlers } from './llamacpp.js'
import { createMlxHandlers } from './mlx.js'
import { createSecretsHandlers } from './secrets.js'
import { createServerHandlers } from './server.js'
import { createStoreHandlers } from './store.js'
import { createThreadsHandlers } from './threads.js'
import { createWindowHandlers } from './window.js'
import { createUpdaterHandlers } from '../updater.js'

type Args = Record<string, unknown>

export type CommandHandler = (args: Args | undefined) => unknown | Promise<unknown>

export interface CommandContext {
  getMainWindow: () => BrowserWindow | null
  createChildWindow: (label: string, options: Record<string, unknown>) => BrowserWindow
}

export class UnimplementedCommandError extends Error {
  readonly code = 'unimplemented_command'
  constructor(readonly cmd: string) {
    super(`Command '${cmd}' is not implemented in the Electron bridge yet`)
  }
}

export function createCommandRegistry(context: CommandContext): Map<string, CommandHandler> {
  const registry = new Map<string, CommandHandler>()
  const merge = (handlers: Record<string, CommandHandler>) => {
    for (const [name, handler] of Object.entries(handlers)) registry.set(name, handler)
  }
  merge(createFsHandlers(context.getMainWindow))
  merge(createAppHandlers())
  merge(createAxBiHandlers())
  merge(createSecretsHandlers())
  merge(createWindowHandlers(context.createChildWindow))
  merge(createStoreHandlers())
  merge(createThreadsHandlers())
  merge(createServerHandlers())
  merge(createDownloadHandlers())
  merge(createLlamacppHandlers())
  merge(createHardwareHandlers())
  merge(createAxEngineHandlers())
  merge(createMlxHandlers())
  merge(createUpdaterHandlers())
  return registry
}

/** Broadcast a backend-originated event to every renderer (Tauri `emit_all` analogue). */
export { emitToAllWindows } from '../events.js'

/**
 * Wire the `ax:invoke` / `ax:event-emit` channels. Returns a dispose function
 * that detaches both (used by the embed API's handle.dispose()).
 */
export function registerIpcHandlers(context: CommandContext): () => void {
  const registry = createCommandRegistry(context)

  ipcMain.handle('ax:invoke', async (_event, cmd: string, args: Args | undefined) => {
    const handler = registry.get(cmd)
    if (!handler) throw new UnimplementedCommandError(cmd)
    try {
      return await handler(args)
    } catch (error) {
      // Structured errors survive IPC as { code, cmd, message } JSON in the
      // Error message; the renderer shim decodes them back into typed errors.
      const err = error as Error & { code?: string }
      throw new Error(
        JSON.stringify({
          code: err.code ?? 'command_error',
          cmd,
          message: err.message ?? String(error),
        })
      )
    }
  })

  // Renderer-originated events (Tauri `emit`) fan out to all OTHER windows;
  // the shim dispatches locally for its own window, matching Tauri's
  // exactly-once broadcast semantics for cross-window events like
  // `theme-changed`.
  const eventListener = (
    event: Electron.IpcMainEvent,
    message: { name: string; payload: unknown }
  ): void => {
    if (typeof message?.name !== 'string') return
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.id !== event.sender.id) {
        win.webContents.send('ax:event', { kind: 'event', name: message.name, payload: message.payload })
      }
    }
  }
  ipcMain.on('ax:event-emit', eventListener)

  return () => {
    ipcMain.removeHandler('ax:invoke')
    ipcMain.removeListener('ax:event-emit', eventListener)
  }
}
