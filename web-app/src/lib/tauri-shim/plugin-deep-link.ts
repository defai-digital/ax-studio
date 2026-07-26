// Electron shim for @tauri-apps/plugin-deep-link — see docs/architecture/electron-migration-phase0-matrix.md
//
// TODO(phase-4): register the ax-studio:// protocol in Electron main and emit
// 'deep-link' events; until then no deep links are delivered.
import { listen } from './api-event'

export async function onOpenUrl(
  handler: (urls: string[]) => void
): Promise<() => void> {
  return listen<string[]>('deep-link', (event) => {
    if (Array.isArray(event.payload)) handler(event.payload)
  })
}

export async function getCurrent(): Promise<string[] | null> {
  return null
}
