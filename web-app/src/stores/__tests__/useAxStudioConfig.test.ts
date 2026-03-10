import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// Import after mocks are set up
const { useAxStudioConfig } = await import('../useAxStudioConfig')

const DEFAULTS = {
  apiServiceUrl: 'http://127.0.0.1:18080',
  retrievalServiceUrl: 'http://127.0.0.1:8001',
  agentsServiceUrl: 'http://127.0.0.1:8002',
  akidbUrl: 'http://127.0.0.1:8003',
}

beforeEach(() => {
  localStorage.clear()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue(undefined)
  useAxStudioConfig.setState({ config: { ...DEFAULTS } })
})

describe('useAxStudioConfig — initial state', () => {
  it('uses the correct default URLs', () => {
    const { config } = useAxStudioConfig.getState()
    expect(config.apiServiceUrl).toBe('http://127.0.0.1:18080')
    expect(config.retrievalServiceUrl).toBe('http://127.0.0.1:8001')
    expect(config.agentsServiceUrl).toBe('http://127.0.0.1:8002')
    expect(config.akidbUrl).toBe('http://127.0.0.1:8003')
  })
})

describe('URL getters', () => {
  it('getApiServiceUrl returns the configured URL', () => {
    expect(useAxStudioConfig.getState().getApiServiceUrl()).toBe('http://127.0.0.1:18080')
  })

  it('getRetrievalUrl returns the configured URL', () => {
    expect(useAxStudioConfig.getState().getRetrievalUrl()).toBe('http://127.0.0.1:8001')
  })

  it('getAgentsUrl returns the configured URL', () => {
    expect(useAxStudioConfig.getState().getAgentsUrl()).toBe('http://127.0.0.1:8002')
  })

  it('getAkidbUrl returns the configured URL', () => {
    expect(useAxStudioConfig.getState().getAkidbUrl()).toBe('http://127.0.0.1:8003')
  })

  it('getApiServiceUrl falls back to default when URL is empty', () => {
    useAxStudioConfig.setState({ config: { ...DEFAULTS, apiServiceUrl: '' } })
    expect(useAxStudioConfig.getState().getApiServiceUrl()).toBe('http://127.0.0.1:18080')
  })

  it('getRetrievalUrl falls back to default when URL is empty', () => {
    useAxStudioConfig.setState({ config: { ...DEFAULTS, retrievalServiceUrl: '' } })
    expect(useAxStudioConfig.getState().getRetrievalUrl()).toBe('http://127.0.0.1:8001')
  })

  it('getAgentsUrl falls back to default when URL is empty', () => {
    useAxStudioConfig.setState({ config: { ...DEFAULTS, agentsServiceUrl: '' } })
    expect(useAxStudioConfig.getState().getAgentsUrl()).toBe('http://127.0.0.1:8002')
  })

  it('getAkidbUrl falls back to default when URL is empty', () => {
    useAxStudioConfig.setState({ config: { ...DEFAULTS, akidbUrl: '' } })
    expect(useAxStudioConfig.getState().getAkidbUrl()).toBe('http://127.0.0.1:8003')
  })
})

describe('setConfig', () => {
  it('updates a single URL field', async () => {
    await useAxStudioConfig.getState().setConfig({ apiServiceUrl: 'http://192.168.1.1:9000' })
    expect(useAxStudioConfig.getState().config.apiServiceUrl).toBe('http://192.168.1.1:9000')
  })

  it('merges partial updates without overwriting other fields', async () => {
    await useAxStudioConfig.getState().setConfig({ akidbUrl: 'http://10.0.0.1:5000' })
    const { config } = useAxStudioConfig.getState()
    expect(config.akidbUrl).toBe('http://10.0.0.1:5000')
    expect(config.apiServiceUrl).toBe(DEFAULTS.apiServiceUrl)
    expect(config.retrievalServiceUrl).toBe(DEFAULTS.retrievalServiceUrl)
    expect(config.agentsServiceUrl).toBe(DEFAULTS.agentsServiceUrl)
  })

  it('calls syncToBackend after updating', async () => {
    await useAxStudioConfig.getState().setConfig({ apiServiceUrl: 'http://new-host:8000' })
    expect(mockInvoke).toHaveBeenCalledWith('update_ax_studio_service_config', expect.any(Object))
  })
})

describe('syncToBackend', () => {
  it('invokes update_ax_studio_service_config with snake_case keys', async () => {
    await useAxStudioConfig.getState().syncToBackend()
    expect(mockInvoke).toHaveBeenCalledWith('update_ax_studio_service_config', {
      config: {
        api_service_url: DEFAULTS.apiServiceUrl,
        retrieval_service_url: DEFAULTS.retrievalServiceUrl,
        agents_service_url: DEFAULTS.agentsServiceUrl,
        akidb_url: DEFAULTS.akidbUrl,
      },
    })
  })

  it('does not throw when invoke fails (non-Tauri environment)', async () => {
    mockInvoke.mockRejectedValue(new Error('not in Tauri'))
    await expect(useAxStudioConfig.getState().syncToBackend()).resolves.not.toThrow()
  })
})
