import { create } from 'zustand'

/**
 * Electron AX BI connection state (migration matrix §4). The Tauri build
 * tracks connectivity through the MCP server store instead; this store backs
 * the zero-config direct client: a tiny status indicator near the chat input
 * and the connect card in `/settings/ax-bi`. Not persisted — the
 * bootstrap probe re-derives it on every app start.
 */
export type AxBiConnectionStatus =
  | 'unknown'
  | 'connecting'
  | 'connected'
  | 'needs-key'
  | 'unreachable'

type AxBiConnectionState = {
  status: AxBiConnectionStatus
  /** User-facing detail for the needs-key / unreachable states. */
  message?: string
  setStatus: (status: AxBiConnectionStatus, message?: string) => void
}

export const useAxBiConnection = create<AxBiConnectionState>()((set) => ({
  status: 'unknown',
  message: undefined,
  setStatus: (status, message) => set({ status, message }),
}))
