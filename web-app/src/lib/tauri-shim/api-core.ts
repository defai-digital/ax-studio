// Electron shim for @tauri-apps/api/core — see docs/architecture/electron-migration-phase0-matrix.md
import { bridgeInvoke, registerChannel, unregisterChannel } from './bridge'

let nextChannelId = 1

/** Tauri Channel analogue: main pushes messages keyed by numeric channel id. */
export class Channel<T = unknown> {
  readonly __axIsChannel = true as const
  readonly id: number
  onmessage?: (response: T) => void

  constructor() {
    this.id = nextChannelId++
    registerChannel(this.id, (payload) => {
      this.onmessage?.(payload as T)
    })
  }

  /** Release the channel handler; mirrors dropping the JS reference in Tauri. */
  disconnect(): void {
    unregisterChannel(this.id)
  }
}

export async function invoke<T>(cmd: string, args?: unknown): Promise<T> {
  return bridgeInvoke<T>(cmd, args)
}

export function convertFileSrc(filePath: string, protocol = 'ax-file'): string {
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  return `${protocol}://localhost${encoded.startsWith('/') ? '' : '/'}${encoded}`
}
