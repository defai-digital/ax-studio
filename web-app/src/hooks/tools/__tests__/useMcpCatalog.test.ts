import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMcpCatalog } from '../useMcpCatalog'
import { useMCPServers } from '../useMCPServers'

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      updateMCPConfig: vi.fn(),
      restartMCPServers: vi.fn(),
    }),
  }),
}))

describe('useMcpCatalog', () => {
  beforeEach(() => {
    useMCPServers.setState({ mcpServers: {} })
  })

  it('parses the bundled catalog into validated entries', () => {
    const { result } = renderHook(() => useMcpCatalog())
    expect(result.current.entries.length).toBeGreaterThanOrEqual(8)
    for (const entry of result.current.entries) {
      expect(entry.name).toBeTruthy()
      expect(entry.title).toBeTruthy()
      expect(entry.capabilitiesNote).toBeTruthy()
      expect(['stdio', 'http', 'sse']).toContain(entry.transport)
    }
  })

  it('reports installed servers by name', () => {
    useMCPServers.setState({
      mcpServers: {
        github: {
          command: 'npx',
          args: [],
          env: {},
          active: false,
        },
      },
    })
    const { result } = renderHook(() => useMcpCatalog())
    expect(result.current.isInstalled('github')).toBe(true)
    expect(result.current.isInstalled('brave-search')).toBe(false)
    expect(result.current.isInstalled('__proto__')).toBe(false)
  })

  it('updates isInstalled when servers change', () => {
    const { result } = renderHook(() => useMcpCatalog())
    expect(result.current.isInstalled('memory')).toBe(false)

    act(() => {
      useMCPServers.setState({
        mcpServers: {
          memory: { command: 'npx', args: [], env: {} },
        },
      })
    })
    expect(result.current.isInstalled('memory')).toBe(true)
  })
})
