import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MCPTool } from '@/types/mcp'
import { SystemEvent } from '@/types/events'

const mocks = vi.hoisted(() => {
  const getTools = vi.fn()
  const listen = vi.fn()
  const serviceHub = {
    mcp: () => ({
      getTools,
    }),
    events: () => ({
      listen,
    }),
  }

  return {
    getTools,
    updateTools: vi.fn(),
    updateMcpToolNames: vi.fn(),
    listen,
    unsubscribe: vi.fn(),
    isDefaultsInitialized: vi.fn(),
    setDefaultDisabledTools: vi.fn(),
    markDefaultsAsInitialized: vi.fn(),
    serviceHub,
  }
})

// Mock useAppState
vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (
    selector: (state: {
      updateTools: typeof mocks.updateTools
      updateMcpToolNames: typeof mocks.updateMcpToolNames
    }) => unknown
  ) =>
    selector({
      updateTools: mocks.updateTools,
      updateMcpToolNames: mocks.updateMcpToolNames,
    }),
}))

// Mock the ServiceHub
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => mocks.serviceHub,
  useServiceHub: () => mocks.serviceHub,
}))

vi.mock('@/hooks/tools/useToolAvailable', () => ({
  useToolAvailable: () => ({
    isDefaultsInitialized: mocks.isDefaultsInitialized,
    setDefaultDisabledTools: mocks.setDefaultDisabledTools,
    markDefaultsAsInitialized: mocks.markDefaultsAsInitialized,
  }),
}))

describe('useTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listen.mockResolvedValue(mocks.unsubscribe)
    mocks.getTools.mockResolvedValue([])
    mocks.isDefaultsInitialized.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should call getTools and updateTools on mount', async () => {
    const { useTools } = await import('../useTools')

    const mockTools = [
      createTool('test-tool', 'A test tool'),
      createTool('another-tool', 'Another test tool'),
    ]
    mocks.getTools.mockResolvedValue(mockTools)

    renderHook(() => useTools())

    // Wait for async operations to complete
    await flushAsyncWork()

    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    expect(mocks.updateTools).toHaveBeenCalledWith(mockTools)
    expect(mocks.updateMcpToolNames).toHaveBeenCalledWith([
      'test-tool',
      'another-tool',
    ])
  })

  it('should set up event listener for MCP_UPDATE', async () => {
    const { useTools } = await import('../useTools')

    renderHook(() => useTools())

    await flushAsyncWork()

    expect(mocks.listen).toHaveBeenCalledWith(
      SystemEvent.MCP_UPDATE,
      expect.any(Function)
    )
  })

  it('should call setTools when MCP_UPDATE event is triggered', async () => {
    const { useTools } = await import('../useTools')

    const mockTools = [createTool('updated-tool', 'Updated tool')]
    mocks.getTools.mockResolvedValue(mockTools)

    let eventCallback: (() => void) | undefined

    mocks.listen.mockImplementation((_event, callback) => {
      eventCallback = callback
      return Promise.resolve(mocks.unsubscribe)
    })

    renderHook(() => useTools())

    // Wait for initial setup
    await flushAsyncWork()

    // Clear the initial calls
    vi.clearAllMocks()
    mocks.getTools.mockResolvedValue(mockTools)

    // Trigger the event
    await act(async () => {
      eventCallback?.()
    })
    await flushAsyncWork()

    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    expect(mocks.updateTools).toHaveBeenCalledWith(mockTools)
  })

  it('should return unsubscribe function for cleanup', async () => {
    const { useTools } = await import('../useTools')

    const { unmount } = renderHook(() => useTools())

    await flushAsyncWork()

    expect(mocks.listen).toHaveBeenCalled()

    // Unmount should call the unsubscribe function
    unmount()

    expect(mocks.listen).toHaveBeenCalledWith(
      SystemEvent.MCP_UPDATE,
      expect.any(Function)
    )
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('should handle getTools errors gracefully', async () => {
    const { useTools } = await import('../useTools')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getTools.mockRejectedValue(new Error('Failed to get tools'))

    renderHook(() => useTools())

    await act(async () => {
      // Give enough time for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    // updateTools should not be called if getTools fails
    expect(mocks.updateTools).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should handle event listener setup errors gracefully', async () => {
    const { useTools } = await import('../useTools')

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listen.mockRejectedValue(new Error('Failed to set up listener'))

    renderHook(() => useTools())

    await act(async () => {
      // Give enough time for the promise to be handled
      await new Promise(resolve => setTimeout(resolve, 100))
    })

    // Initial getTools should still work
    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    expect(mocks.listen).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })

  it('should not update tools after unmount while refresh is pending', async () => {
    const { useTools } = await import('../useTools')
    const pendingTools = createDeferred<MCPTool[]>()
    mocks.getTools.mockReturnValue(pendingTools.promise)

    const { unmount } = renderHook(() => useTools())

    unmount()

    await act(async () => {
      pendingTools.resolve([createTool('late-tool')])
      await pendingTools.promise
    })
    await flushAsyncWork()

    expect(mocks.updateTools).not.toHaveBeenCalled()
    expect(mocks.updateMcpToolNames).not.toHaveBeenCalled()
  })

  it('should ignore stale refresh results when a newer MCP update completes first', async () => {
    const { useTools } = await import('../useTools')
    const slowTools = createDeferred<MCPTool[]>()
    const staleTools = [createTool('stale-tool')]
    const freshTools = [createTool('fresh-tool')]
    let eventCallback: (() => void) | undefined

    mocks.getTools
      .mockImplementationOnce(() => slowTools.promise)
      .mockResolvedValueOnce(freshTools)
    mocks.listen.mockImplementation((_event, callback) => {
      eventCallback = callback
      return Promise.resolve(mocks.unsubscribe)
    })

    renderHook(() => useTools())
    await flushAsyncWork()

    await act(async () => {
      eventCallback?.()
    })
    await flushAsyncWork()

    expect(mocks.updateTools).toHaveBeenCalledTimes(1)
    expect(mocks.updateTools).toHaveBeenCalledWith(freshTools)
    expect(mocks.updateMcpToolNames).toHaveBeenCalledWith(['fresh-tool'])

    await act(async () => {
      slowTools.resolve(staleTools)
      await slowTools.promise
    })
    await flushAsyncWork()

    expect(mocks.updateTools).toHaveBeenCalledTimes(1)
    expect(mocks.updateTools).not.toHaveBeenCalledWith(staleTools)
  })

  it('should not rerun with stable dependencies on rerender', async () => {
    const { useTools } = await import('../useTools')

    const { rerender } = renderHook(() => useTools())

    // Initial render
    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    expect(mocks.listen).toHaveBeenCalledTimes(1)

    // Rerender should not trigger additional calls
    rerender()
    expect(mocks.getTools).toHaveBeenCalledTimes(1)
    expect(mocks.listen).toHaveBeenCalledTimes(1)
  })
})

function createTool(name: string, description = 'A test tool'): MCPTool {
  return {
    name,
    description,
    inputSchema: {},
    server: 'test-server',
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })
}
