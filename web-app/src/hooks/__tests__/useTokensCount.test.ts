import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock dependencies
vi.mock('../usePrompt', () => ({
  usePrompt: vi.fn().mockReturnValue({ prompt: 'test prompt' }),
}))

const mockGetTokensCount = vi.fn()

vi.mock('../useModelProvider', () => ({
  useModelProvider: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      selectedModel: {
        id: 'test-model',
        settings: {
          ctx_len: {
            controller_props: { value: 4096 },
          },
        },
      },
    })
  ),
}))

vi.mock('../useServiceHub', () => ({
  useServiceStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      serviceHub: {
        models: () => ({
          getTokensCount: mockGetTokensCount,
        }),
      },
    })
  ),
  useServiceHub: vi.fn(),
  getServiceHub: vi.fn(),
}))

import { useTokensCount } from '../useTokensCount'
import type { ThreadMessage } from '@ax-studio/core'

describe('useTokensCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetTokensCount.mockResolvedValue(100)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should initialize with default token data', () => {
    const { result } = renderHook(() => useTokensCount([]))

    expect(result.current.tokenCount).toBe(0)
    expect(result.current.loading).toBe(false)
    expect(result.current.isNearLimit).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it('should return zero token count when messages are empty', async () => {
    const { result } = renderHook(() => useTokensCount([]))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current.tokenCount).toBe(0)
    expect(result.current.loading).toBe(false)
  })

  it('should calculate tokens after debounce when messages are provided', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello world', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    mockGetTokensCount.mockResolvedValue(500)

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(mockGetTokensCount).toHaveBeenCalledWith('test-model', messages)
    expect(result.current.tokenCount).toBe(500)
    expect(result.current.loading).toBe(false)
  })

  it('should compute percentage and isNearLimit correctly', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    // 3500 / 4096 = ~85.4% which is >= 80%
    mockGetTokensCount.mockResolvedValue(3500)

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current.tokenCount).toBe(3500)
    expect(result.current.maxTokens).toBe(4096)
    expect(result.current.isNearLimit).toBe(true)
    expect(result.current.percentage).toBeCloseTo(85.449, 1)
  })

  it('should handle errors from token count service', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    mockGetTokensCount.mockRejectedValue(new Error('Service unavailable'))

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current.tokenCount).toBe(0)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('Service unavailable')
  })

  it('should provide calculateTokens function for manual trigger', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    mockGetTokensCount.mockResolvedValue(200)

    const { result } = renderHook(() => useTokensCount(messages))

    // Wait for debounced auto-calculation
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    mockGetTokensCount.mockResolvedValue(350)

    await act(async () => {
      await result.current.calculateTokens()
    })

    expect(result.current.tokenCount).toBe(350)
  })

  it('should handle 404 error with long backoff', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    mockGetTokensCount.mockRejectedValue(new Error('Not found 404'))

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current.error).toBe('Not found 404')

    // Second call should be skipped due to backoff
    mockGetTokensCount.mockClear()
    mockGetTokensCount.mockResolvedValue(100)

    await act(async () => {
      await result.current.calculateTokens()
    })

    // Should not have called the service again due to 1-hour backoff
    expect(mockGetTokensCount).not.toHaveBeenCalled()
  })
})

describe('useTokensCount messageSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetTokensCount.mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should not recalculate when messages reference changes but signature stays same', async () => {
    const messages1: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]
    const messages2: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    const { rerender } = renderHook(
      ({ msgs }) => useTokensCount(msgs),
      { initialProps: { msgs: messages1 } }
    )

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    const callCount = mockGetTokensCount.mock.calls.length

    rerender({ msgs: messages2 })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // The signature is the same so the debounce effect should not trigger again
    // (the dependency messageSignature hasn't changed)
    expect(mockGetTokensCount.mock.calls.length).toBe(callCount)
  })
})
