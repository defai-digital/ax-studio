// Electron shim for @tauri-apps/api/event — see docs/architecture/electron-migration-phase0-matrix.md
import {
  addEventListener,
  emitEvent,
  type ShimEventHandler,
} from './bridge'

export type EventCallback<T> = (event: { event: string; id: number; payload: T }) => void
export type UnlistenFn = () => void

export async function listen<T>(
  event: string,
  handler: EventCallback<T>
): Promise<UnlistenFn> {
  return addEventListener(event, handler as ShimEventHandler)
}

export async function once<T>(
  event: string,
  handler: EventCallback<T>
): Promise<UnlistenFn> {
  const unlisten = addEventListener(event, (e) => {
    unlisten()
    ;(handler as ShimEventHandler)(e)
  })
  return unlisten
}

export async function emit<T>(event: string, payload?: T): Promise<void> {
  emitEvent(event, payload)
}
