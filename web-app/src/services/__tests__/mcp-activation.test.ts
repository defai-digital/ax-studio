import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { TauriMCPService } from '../mcp/tauri'

describe('TauriMCPService activation commands', () => {
  let service: TauriMCPService

  beforeEach(() => {
    service = new TauriMCPService()
    vi.clearAllMocks()
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
})
