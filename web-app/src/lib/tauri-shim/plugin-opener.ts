// Electron shim for @tauri-apps/plugin-opener — see docs/architecture/electron-migration-phase0-matrix.md
import { bridgeInvoke } from './bridge'

export async function openUrl(url: string): Promise<void> {
  await bridgeInvoke('open_external_url', { url })
}

export async function revealItemInDir(path: string): Promise<void> {
  await bridgeInvoke('open_file_explorer', { path })
}
