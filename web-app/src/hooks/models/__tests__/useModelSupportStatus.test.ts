import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useModelSupportStatus } from '../useModelSupportStatus'

const mocks = vi.hoisted(() => ({
  isModelSupported: vi.fn(),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      isModelSupported: mocks.isModelSupported,
    }),
  }),
}))

describe('useModelSupportStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sets loading and then the returned support status', async () => {
    mocks.isModelSupported.mockResolvedValue('GREEN')

    const { result } = renderHook(() => useModelSupportStatus())

    await act(async () => {
      await result.current.checkModelSupport({
        model_id: 'model-a',
        path: '/models/model-a.gguf',
      })
    })

    expect(mocks.isModelSupported).toHaveBeenCalledWith(
      '/models/model-a.gguf',
      8192
    )
    expect(result.current.modelSupportStatus['model-a']).toBe('GREEN')
  })

  it('marks the model red when support probing fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mocks.isModelSupported.mockRejectedValue(new Error('probe failed'))

    const { result } = renderHook(() => useModelSupportStatus())

    await act(async () => {
      await result.current.checkModelSupport({
        model_id: 'model-a',
        path: '/models/model-a.gguf',
      })
    })

    expect(result.current.modelSupportStatus['model-a']).toBe('RED')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error checking model support:',
      expect.any(Error)
    )
  })

  it('does not start duplicate in-flight checks for the same model', async () => {
    let resolveStatus: (status: string) => void = () => {}
    mocks.isModelSupported.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve
        })
    )

    const { result } = renderHook(() => useModelSupportStatus())

    void act(() => {
      void result.current.checkModelSupport({
        model_id: 'model-a',
        path: '/models/model-a.gguf',
      })
    })

    await waitFor(() => {
      expect(result.current.modelSupportStatus['model-a']).toBe('LOADING')
    })

    await act(async () => {
      await result.current.checkModelSupport({
        model_id: 'model-a',
        path: '/models/model-a.gguf',
      })
    })

    expect(mocks.isModelSupported).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveStatus('YELLOW')
    })

    expect(result.current.modelSupportStatus['model-a']).toBe('YELLOW')
  })
})
