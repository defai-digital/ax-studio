// Electron shim bridge internals — see docs/architecture/electron-migration-phase0-matrix.md
//
// Shared plumbing behind every tauri-shim module: access to the preload
// bridge (`window.axElectron`), Channel/event registries, and structured
// error decoding. Not aliased to any @tauri-apps import path directly.

export interface AxBridgeEnvelope {
  kind: 'event' | 'channel'
  name?: string
  channelId?: number
  payload?: unknown
}

export interface AxElectronBridge {
  /** True under `electron . --smoke` (see electron/src/preload.ts). */
  smoke?: boolean
  invoke(cmd: string, args?: unknown): Promise<unknown>
  sendEvent(name: string, payload?: unknown): void
  onEvent(callback: (envelope: AxBridgeEnvelope) => void): () => void
}

declare global {
  interface Window {
    axElectron?: AxElectronBridge
  }
}

export function getBridge(): AxElectronBridge {
  const bridge = typeof window !== 'undefined' ? window.axElectron : undefined
  if (!bridge) {
    throw new Error(
      'Electron bridge unavailable: window.axElectron is not exposed (preload not loaded?)'
    )
  }
  return bridge
}

// ─── Channel registry ────────────────────────────────────────────────────────

const channelHandlers = new Map<number, (payload: unknown) => void>()

export function registerChannel(id: number, handler: (payload: unknown) => void): void {
  channelHandlers.set(id, handler)
  ensureBridgeSubscription()
}

export function unregisterChannel(id: number): void {
  channelHandlers.delete(id)
}

/** Duck-type marker set by the shim Channel class (avoids a circular import). */
function isChannelLike(value: unknown): value is { __axIsChannel: true; id: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __axIsChannel?: unknown }).__axIsChannel === true
  )
}

/** Deep-replace Channel instances with their wire representation. */
function serializeArgs(value: unknown): unknown {
  if (isChannelLike(value)) return { __axChannel: value.id }
  if (typeof value === 'function') {
    throw new Error(
      'Unsupported invoke argument: functions cannot cross the Electron IPC bridge (use a Channel)'
    )
  }
  if (Array.isArray(value)) return value.map(serializeArgs)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) out[key] = serializeArgs(entry)
    }
    return out
  }
  return value
}

// ─── Event bus ───────────────────────────────────────────────────────────────

export type ShimEventHandler = (event: {
  event: string
  id: number
  payload: unknown
}) => void

const eventListeners = new Map<string, Set<ShimEventHandler>>()
let eventSeq = 0
let bridgeSubscribed = false

function ensureBridgeSubscription(): void {
  if (bridgeSubscribed) return
  bridgeSubscribed = true
  getBridge().onEvent((envelope) => {
    if (envelope.kind === 'channel' && typeof envelope.channelId === 'number') {
      channelHandlers.get(envelope.channelId)?.(envelope.payload)
      return
    }
    if (envelope.kind === 'event' && typeof envelope.name === 'string') {
      dispatchLocal(envelope.name, envelope.payload)
    }
  })
}

function dispatchLocal(name: string, payload: unknown): void {
  const handlers = eventListeners.get(name)
  if (!handlers) return
  const event = { event: name, id: ++eventSeq, payload }
  for (const handler of [...handlers]) {
    try {
      handler(event)
    } catch (error) {
      console.error(`[tauri-shim] event handler for '${name}' threw:`, error)
    }
  }
}

export function addEventListener(name: string, handler: ShimEventHandler): () => void {
  ensureBridgeSubscription()
  let handlers = eventListeners.get(name)
  if (!handlers) {
    handlers = new Set()
    eventListeners.set(name, handlers)
  }
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0) eventListeners.delete(name)
  }
}

/** Tauri `emit`: dispatch in this window and broadcast to other windows via main. */
export function emitEvent(name: string, payload?: unknown): void {
  dispatchLocal(name, payload)
  getBridge().sendEvent(name, payload)
}

// ─── Invoke ─────────────────────────────────────────────────────────────────

export interface StructuredCommandError {
  code: string
  cmd: string
  message: string
}

export async function bridgeInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  try {
    return (await getBridge().invoke(cmd, serializeArgs(args))) as T
  } catch (error) {
    // Main encodes failures as JSON in the Error message so `code` survives IPC.
    const message = error instanceof Error ? error.message : String(error)
    const jsonStart = message.indexOf('{')
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(message.slice(jsonStart)) as StructuredCommandError
        const decoded = new Error(parsed.message) as Error & { code?: string; cmd?: string }
        decoded.code = parsed.code
        decoded.cmd = parsed.cmd
        throw decoded
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          // Not a structured error — fall through to the raw rethrow.
        } else {
          throw parseError
        }
      }
    }
    throw error
  }
}
