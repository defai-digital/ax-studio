import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock dependencies
vi.mock('./usePrompt', () => ({
  usePrompt: vi.fn().mockReturnValue({ prompt: 'test prompt' }),
}))

const mockGetTokensCount = vi.fn()

let mockUseModelProviderImpl = (selector: (s: unknown) => unknown) =>
  selector({
    selectedModel: {
      id: 'test-model',
      settings: {
        ctx_len: {
          controller_props: { value: 4096 },
        },
      },
    },
    providers: [
      {
        provider: 'local',
        base_url: 'http://localhost:8080',
        models: [{ id: 'test-model' }],
        settings: [], // No API key required for local
      },
    ],
  })

vi.mock('./useModelProvider', () => ({
  useModelProvider: vi.fn((selector) => mockUseModelProviderImpl(selector)),
}))

vi.mock('./useServiceHub', () => ({
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

vi.mock('./useServiceHub', () => ({
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

import { useTokensCount } from './useTokensCount'
import type { ThreadMessage } from '@ax-studio/core'

describe('useTokensCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetTokensCount.mockResolvedValue(100)

    // Default mock for local model
    mockUseModelProviderImpl = (selector: (s: unknown) => unknown) =>
      selector({
        selectedModel: {
          id: 'test-model',
          settings: {
            ctx_len: {
              controller_props: { value: 4096 },
            },
          },
        },
        providers: [
          {
            provider: 'local',
            base_url: 'http://localhost:8080',
            models: [{ id: 'test-model' }],
            settings: [], // No API key required for local
          },
        ],
      })
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

  it('should use local token estimation for hosted models', async () => {
    // Mock hosted model (OpenAI)
    mockUseModelProviderImpl = (selector: (s: unknown) => unknown) =>
      selector({
        selectedModel: {
          id: 'gpt-4',
          settings: {
            ctx_len: {
              controller_props: { value: 8192 },
            },
          },
        },
        providers: [
          {
            provider: 'openai',
            base_url: 'https://api.openai.com/v1',
            models: [{ id: 'gpt-4' }],
            settings: [
              {
                key: 'api-key',
                controller_type: 'input',
                controller_props: { value: '' },
              },
            ],
          },
        ],
      })

    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello world this is a test message', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Should use local estimation: ~4 chars per token
    // "Hello world this is a test message" ≈ 9 tokens (approximate)
    expect(result.current.tokenCount).toBe(9)
    expect(result.current.maxTokens).toBe(8192)
    // Should not call the backend service for hosted models
    expect(mockGetTokensCount).not.toHaveBeenCalled()
  })

  it('should continue using backend service for local models', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    mockGetTokensCount.mockResolvedValue(150)

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Should use backend service for local models
    expect(mockGetTokensCount).toHaveBeenCalledWith('test-model', messages)
    expect(result.current.tokenCount).toBe(150)
  })

  it('should handle errors for hosted models without backoff', async () => {
    // Mock hosted model
    mockUseModelProviderImpl = (selector: (s: unknown) => unknown) =>
      selector({
        selectedModel: {
          id: 'hosted-model',
          settings: {
            ctx_len: {
              controller_props: { value: 4096 },
            },
          },
        },
        providers: [
          {
            provider: 'hosted',
            base_url: 'https://api.example.com',
            models: [{ id: 'hosted-model' }],
            settings: [
              {
                key: 'api-key',
                controller_type: 'input',
                controller_props: { value: '' },
              },
            ],
          },
        ],
      })

    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Test message', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    // Even if service call fails, hosted models should use local estimation
    mockGetTokensCount.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Should use local estimation despite service error
    // "Test message" = 12 chars / 4 = 3 tokens
    expect(result.current.tokenCount).toBe(3)
    expect(result.current.error).toBeUndefined() // No error for hosted models
  })

  it('should correctly identify local models (no API key required)', async () => {
    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    mockGetTokensCount.mockResolvedValue(50)

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Should use backend for local models (no API key setting)
    expect(mockGetTokensCount).toHaveBeenCalled()
    expect(result.current.tokenCount).toBe(50)
  })

  it('should correctly identify hosted models (external URL + API key)', async () => {
    // Temporarily change mock to hosted model
    const originalImpl = mockUseModelProviderImpl
    mockUseModelProviderImpl = (selector: (s: unknown) => unknown) =>
      selector({
        selectedModel: { id: 'hosted-model' },
        providers: [
          {
            provider: 'openai',
            base_url: 'https://api.openai.com/v1',
            models: [{ id: 'hosted-model' }],
            settings: [{ key: 'api-key' }],
          },
        ],
      })

    const messages: ThreadMessage[] = [
      {
        id: '1',
        role: 'user',
        content: [{ type: 'text', text: { value: 'Hello', annotations: [] } }],
      } as unknown as ThreadMessage,
    ]

    const { result } = renderHook(() => useTokensCount(messages))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // Should use local estimation for hosted models
    expect(mockGetTokensCount).not.toHaveBeenCalled()
    expect(result.current.tokenCount).toBe(2) // "Hello" = 5 chars / 4 = 2 tokens

    // Restore original mock
    mockUseModelProviderImpl = originalImpl
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
