import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/schemas/events.schema', () => ({
  deepLinkPayloadSchema: {
    safeParse: vi.fn((val) => {
      if (typeof val === 'string') return { success: true, data: val }
      return { success: false, error: { message: 'not a string' } }
    }),
  },
}))

vi.mock('@/schemas/assistants.schema', () => ({
  assistantsSchema: {
    safeParse: vi.fn((data) => {
      if (Array.isArray(data) && data.every((d: { id?: string }) => d.id)) {
        return { success: true, data }
      }
      return { success: false, error: { message: 'invalid' } }
    }),
  },
}))

vi.mock('@/lib/providers/provider-sync', () => ({
  syncRemoteProviders: vi.fn().mockResolvedValue(undefined),
}))

import {
  bootstrapProviders,
  type BootstrapProvidersInput,
} from './bootstrap-providers'

function makeServiceHub(overrides: Record<string, unknown> = {}) {
  return {
    providers: () => ({
      getProviders: vi.fn().mockResolvedValue([
        { id: 'p1', provider: 'openai', name: 'OpenAI' },
      ]),
      ...((overrides.providers as Record<string, unknown>) ?? {}),
    }),
    mcp: () => ({
      getMCPConfig: vi.fn().mockResolvedValue({
        mcpServers: { server1: { command: 'test' } },
        mcpSettings: { autoApprove: true },
      }),
      ...((overrides.mcp as Record<string, unknown>) ?? {}),
    }),
    assistants: () => ({
      getAssistants: vi.fn().mockResolvedValue([
        { id: 'a1', name: 'Default', created_at: Date.now() },
      ]),
      ...((overrides.assistants as Record<string, unknown>) ?? {}),
    }),
    deeplink: () => ({
      getCurrent: vi.fn().mockResolvedValue(null),
      onOpenUrl: vi.fn(),
      ...((overrides.deeplink as Record<string, unknown>) ?? {}),
    }),
    events: () => ({
      listen: vi.fn().mockResolvedValue(() => {}),
      ...((overrides.events as Record<string, unknown>) ?? {}),
    }),
    path: () => ({
      sep: () => '/',
    }),
  }
}

function makeInput(overrides: Partial<BootstrapProvidersInput> = {}): BootstrapProvidersInput {
  return {
    serviceHub: makeServiceHub() as unknown as BootstrapProvidersInput['serviceHub'],
    setProviders: vi.fn(),
    setServers: vi.fn(),
    setSettings: vi.fn(),
    setAssistants: vi.fn(),
    initializeWithLastUsed: vi.fn(),
    onDeepLink: vi.fn(),
    ...overrides,
  }
}

describe('bootstrapProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Phase 1: Successful bootstrap ───

  it('returns ok result on success', async () => {
    const input = makeInput()
    const { result } = await bootstrapProviders(input)
    expect(result).toEqual({ ok: true })
  })

  it('calls setProviders with loaded providers', async () => {
    const setProviders = vi.fn()
    const input = makeInput({ setProviders })

    await bootstrapProviders(input)

    expect(setProviders).toHaveBeenCalledWith(
      [{ id: 'p1', provider: 'openai', name: 'OpenAI' }],
      '/'
    )
  })

  it('calls setServers with MCP config servers', async () => {
    const setServers = vi.fn()
    const input = makeInput({ setServers })

    await bootstrapProviders(input)

    expect(setServers).toHaveBeenCalledWith({ server1: { command: 'test' } })
  })

  it('calls setSettings with MCP settings', async () => {
    const setSettings = vi.fn()
    const input = makeInput({ setSettings })

    await bootstrapProviders(input)

    expect(setSettings).toHaveBeenCalledWith({ autoApprove: true })
  })

  it('calls setAssistants and initializeWithLastUsed when data is valid', async () => {
    const setAssistants = vi.fn()
    const initializeWithLastUsed = vi.fn()
    const input = makeInput({ setAssistants, initializeWithLastUsed })

    await bootstrapProviders(input)

    expect(setAssistants).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a1', name: 'Default' }),
    ])
    expect(initializeWithLastUsed).toHaveBeenCalled()
  })

  // ─── Phase 2: Individual service failures ───

  it('continues when providers fail to load', async () => {
    const hub = makeServiceHub({
      providers: {
        getProviders: vi.fn().mockRejectedValue(new Error('network error')),
      },
    })
    const setProviders = vi.fn()
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      setProviders,
    })

    const { result } = await bootstrapProviders(input)

    // The function catches provider errors internally
    expect(result).toEqual({ ok: true })
    expect(setProviders).not.toHaveBeenCalled()
  })

  it('continues when MCP config fails to load', async () => {
    const hub = makeServiceHub({
      mcp: {
        getMCPConfig: vi.fn().mockRejectedValue(new Error('mcp error')),
      },
    })
    const setServers = vi.fn()
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      setServers,
    })

    const { result } = await bootstrapProviders(input)
    expect(result).toEqual({ ok: true })
    expect(setServers).not.toHaveBeenCalled()
  })

  it('continues when assistants fail to load', async () => {
    const hub = makeServiceHub({
      assistants: {
        getAssistants: vi.fn().mockRejectedValue(new Error('assistant error')),
      },
    })
    const setAssistants = vi.fn()
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      setAssistants,
    })

    const { result } = await bootstrapProviders(input)
    expect(result).toEqual({ ok: true })
    expect(setAssistants).not.toHaveBeenCalled()
  })

  // ─── Phase 3: MCP config edge cases ───

  it('handles null mcpServers in config', async () => {
    const hub = makeServiceHub({
      mcp: {
        getMCPConfig: vi.fn().mockResolvedValue({ mcpServers: null, mcpSettings: null }),
      },
    })
    const setServers = vi.fn()
    const setSettings = vi.fn()
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      setServers,
      setSettings,
    })

    await bootstrapProviders(input)

    // Falls back to {} for null mcpServers
    expect(setServers).toHaveBeenCalledWith({})
    expect(setSettings).toHaveBeenCalledWith(null)
  })

  // ─── Phase 4: Assistants schema validation ───

  it('does not call setAssistants when data is empty array', async () => {
    const hub = makeServiceHub({
      assistants: {
        getAssistants: vi.fn().mockResolvedValue([]),
      },
    })
    const setAssistants = vi.fn()
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      setAssistants,
    })

    await bootstrapProviders(input)

    // Empty array passes safeParse but length check skips setAssistants
    expect(setAssistants).not.toHaveBeenCalled()
  })

  // ─── Phase 5: Deep link setup ───

  it('calls onDeepLink with current deep link', async () => {
    const onDeepLink = vi.fn()
    const hub = makeServiceHub({
      deeplink: {
        getCurrent: vi.fn().mockResolvedValue(['axstudio://open']),
        onOpenUrl: vi.fn(),
      },
    })
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      onDeepLink,
    })

    await bootstrapProviders(input)

    // getCurrent is called async, onDeepLink is registered
    // The onOpenUrl is called immediately during bootstrap
    const deeplinkService = hub.deeplink()
    expect(deeplinkService.onOpenUrl).toHaveBeenCalledWith(onDeepLink)
  })

  it('returns an unsubscribeDeepLink function', async () => {
    const input = makeInput()
    const { unsubscribeDeepLink } = await bootstrapProviders(input)

    expect(typeof unsubscribeDeepLink).toBe('function')
    // Should not throw when called
    expect(() => unsubscribeDeepLink()).not.toThrow()
  })

  it('returns fail result when outer try/catch catches', async () => {
    // Force an error in the Promise.all by making serviceHub methods throw synchronously
    const badHub = {
      providers: () => { throw new Error('sync kaboom') },
      mcp: () => ({ getMCPConfig: vi.fn().mockResolvedValue({}) }),
      assistants: () => ({ getAssistants: vi.fn().mockResolvedValue([]) }),
      deeplink: () => ({ getCurrent: vi.fn().mockResolvedValue(null), onOpenUrl: vi.fn() }),
      events: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }),
      path: () => ({ sep: () => '/' }),
    }
    const input = makeInput({
      serviceHub: badHub as unknown as BootstrapProvidersInput['serviceHub'],
    })

    const { result } = await bootstrapProviders(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error)
    }
  })
})
