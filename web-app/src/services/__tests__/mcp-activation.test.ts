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
    restartMcpServers: vi.fn(),
  }

  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-ignore
    global.window = { core: { api: mockCoreApi } }
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
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

  it('callToolWithCancellation resolves with the tool result', async () => {
    const toolResult = { error: '', content: [{ text: 'result data' }] }
    mockCoreApi.callTool.mockResolvedValue(toolResult)
    const service = new TauriMCPService()

    const { promise } = service.callToolWithCancellation({
      toolName: 'search',
      arguments: { q: 'hello' },
      cancellationToken: 'tok-1',
    })

    await expect(promise).resolves.toEqual(toolResult)
    expect(mockCoreApi.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'search', cancellationToken: 'tok-1' })
    )
  })

  it('callToolWithCancellation returns a structured error when the API is unavailable (no sync throw)', async () => {
    // @ts-ignore
    global.window = { core: undefined }
    const service = new TauriMCPService()

    // Must return { promise, cancel, token } without throwing synchronously
    const result = service.callToolWithCancellation({ toolName: 'search', arguments: {} })
    expect(result.promise).toBeInstanceOf(Promise)

    // Promise resolves to a structured error (same contract as callTool)
    const resolved = await result.promise
    expect(resolved.error).toBe('MCP API is unavailable')
    expect(resolved.content).toEqual([])
  })

  it('callToolWithCancellation retries once on transport error using the same token', async () => {
    const toolResult = { error: '', content: [{ text: 'retry ok' }] }
    mockCoreApi.callTool
      .mockRejectedValueOnce(new Error('transport closed'))
      .mockResolvedValueOnce(toolResult)
    mockCoreApi.restartMcpServers.mockResolvedValue(undefined)
    const service = new TauriMCPService()

    const { promise } = service.callToolWithCancellation({
      toolName: 'search',
      arguments: { q: 'test' },
      cancellationToken: 'tok-retry',
    })

    await expect(promise).resolves.toEqual(toolResult)
    expect(mockCoreApi.restartMcpServers).toHaveBeenCalledTimes(1)
    expect(mockCoreApi.callTool).toHaveBeenCalledTimes(2)
    // Retry must forward the same cancellation token so it remains cancellable
    expect(mockCoreApi.callTool).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cancellationToken: 'tok-retry' })
    )
  })

  it('callToolWithCancellation returns a structured error for non-recoverable failures without restarting', async () => {
    mockCoreApi.callTool.mockRejectedValue(new Error('permission denied'))
    const service = new TauriMCPService()

    const { promise } = service.callToolWithCancellation({
      toolName: 'restricted_tool',
      arguments: {},
    })

    const result = await promise
    expect(result.error).toBe('permission denied')
    expect(result.content).toEqual([])
    expect(mockCoreApi.restartMcpServers).not.toHaveBeenCalled()
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

  it('cancel() swallows errors when the tool completes before cancel arrives', async () => {
    mockCoreApi.callTool.mockResolvedValue({ error: '', content: [] })
    mockCoreApi.cancelToolCall.mockRejectedValue(
      new Error('Cancellation token tok-done not found')
    )
    const service = new TauriMCPService()

    const { cancel } = service.callToolWithCancellation({
      toolName: 'search',
      arguments: {},
      cancellationToken: 'tok-done',
    })

    // Must not throw even though the Rust side reports the token is gone
    await expect(cancel()).resolves.toBeUndefined()
  })

  it('cancelToolCall invokes cancelToolCall on the core API', async () => {
    mockCoreApi.cancelToolCall.mockResolvedValue(undefined)
    const service = new TauriMCPService()

    await service.cancelToolCall('tok-abc')

    expect(mockCoreApi.cancelToolCall).toHaveBeenCalledWith({ cancellationToken: 'tok-abc' })
  })
})
