import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { TauriMCPService } from '../mcp/tauri'

describe('TauriMCPService activation commands', () => {
  let service: TauriMCPService
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new TauriMCPService()
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('activates MCP servers through invoke', async () => {
    invokeMock.mockResolvedValue(undefined)

    await service.activateMCPServer('server-1', {
      command: 'node',
      args: ['server.js'],
      env: {},
      type: 'stdio',
    })

    expect(invokeMock).toHaveBeenCalledWith('activate_mcp_server', {
      name: 'server-1',
      config: {
        command: 'node',
        args: ['server.js'],
        env: {},
        type: 'stdio',
      },
    })
  })

  it('deactivates MCP servers through invoke', async () => {
    invokeMock.mockResolvedValue(undefined)

    await service.deactivateMCPServer('server-1')

    expect(invokeMock).toHaveBeenCalledWith('deactivate_mcp_server', {
      name: 'server-1',
    })
  })

  it('rethrows activation failures', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))

    await expect(
      service.activateMCPServer('server-1', {
        command: 'node',
        args: [],
        env: {},
        type: 'stdio',
      })
    ).rejects.toThrow('boom')
  })

  it('rethrows deactivation failures', async () => {
    invokeMock.mockRejectedValue(new Error('deactivate boom'))

    await expect(service.deactivateMCPServer('server-1')).rejects.toThrow('deactivate boom')
  })
})

describe('TauriMCPService cancellation commands', () => {
  const mockCoreApi = {
    callTool: vi.fn(),
    cancelToolCall: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-ignore
    global.window = { core: { api: mockCoreApi } }
  })

  it('callToolWithCancellation returns promise, cancel, and token', () => {
    mockCoreApi.callTool.mockResolvedValue({ error: '', content: [] })
    const service = new TauriMCPService()

    const { promise, cancel, token } = service.callToolWithCancellation({
      toolName: 'search',
      arguments: { q: 'hello' },
    })

    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
    expect(typeof cancel).toBe('function')
    expect(promise).toBeInstanceOf(Promise)
  })

  it('callToolWithCancellation uses provided cancellationToken', () => {
    mockCoreApi.callTool.mockResolvedValue({ error: '', content: [] })
    const service = new TauriMCPService()

    const { token } = service.callToolWithCancellation({
      toolName: 'search',
      arguments: {},
      cancellationToken: 'my-token-123',
    })

    expect(token).toBe('my-token-123')
  })

  it('callToolWithCancellation cancel calls cancelToolCall on the core API', async () => {
    mockCoreApi.callTool.mockResolvedValue({ error: '', content: [] })
    mockCoreApi.cancelToolCall.mockResolvedValue(undefined)
    const service = new TauriMCPService()

    const { cancel, token } = service.callToolWithCancellation({
      toolName: 'search',
      arguments: {},
      cancellationToken: 'tok-xyz',
    })

    await cancel()

    expect(mockCoreApi.cancelToolCall).toHaveBeenCalledWith({ cancellationToken: token })
  })

  it('cancelToolCall invokes cancelToolCall on the core API', async () => {
    mockCoreApi.cancelToolCall.mockResolvedValue(undefined)
    const service = new TauriMCPService()

    await service.cancelToolCall('tok-abc')

    expect(mockCoreApi.cancelToolCall).toHaveBeenCalledWith({ cancellationToken: 'tok-abc' })
  })
})
