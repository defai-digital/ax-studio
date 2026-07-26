// Backend-originated event broadcast (Tauri `emit_all` analogue). Kept in its
// own module so the downloads pipeline can emit progress without a circular
// import through the command registry.
import { BrowserWindow } from 'electron'

export function emitToAllWindows(name: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ax:event', { kind: 'event', name, payload })
  }
}
