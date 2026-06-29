import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAxBiLiveEndpoint,
  inferAxBiAction,
  sendAxBiLiveCommand,
  toAxBiInternalPath,
  tryAxBiLiveNavigation,
} from '../live-navigation'
import { useAxBiLiveNavigation } from '@/hooks/settings/useAxBiLiveNavigation'

class MockWebSocket {
  static instances: MockWebSocket[] = []

  listeners: Record<string, Array<(event?: any) => void>> = {}
  sent: string[] = []
  url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
    setTimeout(() => this.emit('open'), 0)
  }

  addEventListener(event: string, callback: (event?: any) => void) {
    this.listeners[event] = [...(this.listeners[event] ?? []), callback]
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close() {
    this.emit('close')
  }

  emit(event: string, payload?: any) {
    for (const callback of this.listeners[event] ?? []) {
      callback(payload)
    }
  }
}

describe('AX-BI live navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    useAxBiLiveNavigation.setState({ enabled: true })
  })

  it('converts local AX-BI URLs to internal paths', () => {
    expect(
      toAxBiInternalPath('http://127.0.0.1:8088/explore/?form_data_key=abc#top')
    ).toBe('/explore/?form_data_key=abc#top')
    expect(toAxBiInternalPath('https://example.com/explore/')).toBeNull()
  })

  it('uses the AX-BI URL port for the live endpoint', () => {
    expect(getAxBiLiveEndpoint('http://127.0.0.1:8088/explore/p/abc/')).toBe(
      'ws://127.0.0.1:8088/ax-bi/live'
    )
  })

  it('infers SQL Lab action from SQL Lab links', () => {
    expect(inferAxBiAction('http://127.0.0.1:8088/sqllab/')).toBe('open_sql_lab')
    expect(inferAxBiAction('http://127.0.0.1:8088/explore/')).toBe('navigate')
  })

  it('returns true when the live command is acknowledged', async () => {
    const promise = sendAxBiLiveCommand('ws://127.0.0.1:8088/ax-bi/live', {
      action: 'navigate',
      url: '/explore/',
    })

    await vi.waitFor(() => expect(MockWebSocket.instances[0]?.sent).toHaveLength(1))
    MockWebSocket.instances[0].emit('message', { data: JSON.stringify({ ok: true }) })

    await expect(promise).resolves.toBe(true)
    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({
      action: 'navigate',
      url: '/explore/',
    })
  })

  it('refuses non-loopback live endpoints', async () => {
    await expect(
      sendAxBiLiveCommand('ws://192.168.1.10:8088/ax-bi/live', {
        action: 'navigate',
        url: '/explore/',
      })
    ).resolves.toBe(false)
    expect(MockWebSocket.instances).toHaveLength(0)
  })

  it('does not send when the setting is disabled', async () => {
    useAxBiLiveNavigation.setState({ enabled: false })

    await expect(
      tryAxBiLiveNavigation('http://127.0.0.1:8088/explore/p/abc/')
    ).resolves.toBe(false)
    expect(MockWebSocket.instances).toHaveLength(0)
  })
})
