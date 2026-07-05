import { useAxBiLiveNavigation } from '@/hooks/settings/useAxBiLiveNavigation'

export type AxBiLiveAction =
  | 'navigate'
  | 'refresh_dashboard'
  | 'refresh_chart'
  | 'open_sql_lab'
  | 'show_toast'

export type AxBiLiveCommand = {
  action: AxBiLiveAction
  url?: string
  message?: string
  dashboardId?: string | number
  chartId?: string | number
}

const AX_BI_HOSTS = new Set(['127.0.0.1', 'localhost'])
const LIVE_PATH = '/ax-bi/live'
const ACK_TIMEOUT_MS = 1000

// Multiple-tab behavior is owned by AX-BI's live endpoint. AX Studio sends one
// command to the local endpoint; AX-BI should route it to the most recently
// connected tab or broadcast it, depending on its server-side implementation.

function isAck(payload: unknown): boolean {
  if (payload === true || payload === 'ok' || payload === 'ack') return true
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return (
    record.ok === true ||
    record.ack === true ||
    record.accepted === true ||
    record.status === 'ok' ||
    record.type === 'ack'
  )
}

function isRejected(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const record = payload as Record<string, unknown>
  return (
    record.ok === false ||
    record.accepted === false ||
    record.status === 'error' ||
    record.type === 'error'
  )
}

function toAxBiInternalPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!AX_BI_HOSTS.has(parsed.hostname)) return null
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    if (url.startsWith('/')) return url
    return null
  }
}

function getAxBiLiveEndpoint(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!AX_BI_HOSTS.has(parsed.hostname)) return null
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return `ws://127.0.0.1:${port}${LIVE_PATH}`
  } catch {
    return null
  }
}

function inferAxBiAction(url: string): AxBiLiveAction {
  const path = toAxBiInternalPath(url)?.toLowerCase() ?? ''
  if (path.includes('sql_lab') || path.includes('sqllab')) return 'open_sql_lab'
  return 'navigate'
}

export async function sendAxBiLiveCommand(
  endpoint: string,
  command: AxBiLiveCommand,
  timeoutMs = ACK_TIMEOUT_MS
): Promise<boolean> {
  if (!endpoint.startsWith('ws://127.0.0.1:')) {
    console.warn('[AX-BI live] refusing non-loopback endpoint', endpoint)
    return false
  }
  const safeCommand: AxBiLiveCommand = { ...command }
  if (safeCommand.url) {
    const internalPath = toAxBiInternalPath(safeCommand.url)
    if (!internalPath) {
      console.warn('[AX-BI live] refusing non-internal AX-BI URL', {
        action: safeCommand.action,
      })
      return false
    }
    safeCommand.url = internalPath
  }

  return new Promise((resolve) => {
    let settled = false
    let socket: WebSocket | undefined
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.info('[AX-BI live] remote command timeout', { endpoint, action: safeCommand.action })
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      resolve(false)
    }, timeoutMs)

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }

    try {
      socket = new WebSocket(endpoint)
    } catch (error) {
      clearTimeout(timer)
      console.info('[AX-BI live] no connected AX-BI tab', error)
      resolve(false)
      return
    }

    socket.addEventListener('open', () => {
      console.info('[AX-BI live] remote command sent', {
        endpoint,
        action: safeCommand.action,
      })
      socket?.send(JSON.stringify(safeCommand))
    })

    socket.addEventListener('message', (event) => {
      let payload: unknown = event.data
      if (typeof event.data === 'string') {
        try {
          payload = JSON.parse(event.data)
        } catch {
          payload = event.data
        }
      }

      if (isAck(payload)) {
        console.info('[AX-BI live] remote command acknowledged', {
          endpoint,
          action: safeCommand.action,
        })
        finish(true)
        return
      }

      if (isRejected(payload)) {
        console.info('[AX-BI live] remote command rejected', {
          endpoint,
          action: safeCommand.action,
        })
        finish(false)
      }
    })

    socket.addEventListener('error', (error) => {
      console.info('[AX-BI live] no connected AX-BI tab', error)
      finish(false)
    })

    socket.addEventListener('close', () => {
      if (!settled) {
        console.info('[AX-BI live] no connected AX-BI tab', {
          endpoint,
          action: safeCommand.action,
        })
      }
      finish(false)
    })
  })
}

export async function tryAxBiLiveNavigation(url: string): Promise<boolean> {
  if (!useAxBiLiveNavigation.getState().enabled) return false

  const endpoint = getAxBiLiveEndpoint(url)
  const internalPath = toAxBiInternalPath(url)
  if (!endpoint || !internalPath) return false

  const acknowledged = await sendAxBiLiveCommand(endpoint, {
    action: inferAxBiAction(url),
    url: internalPath,
  })

  if (!acknowledged) {
    console.info('[AX-BI live] falling back to browser open', { url })
  }

  return acknowledged
}
