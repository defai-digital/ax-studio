import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useGeneralSettingsPage } from '../useGeneralSettingsPage'

const mocks = vi.hoisted(() => ({
  getAppDataFolder: vi.fn(),
  pausePolling: vi.fn(),
  writeText: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({
      factoryReset: vi.fn().mockResolvedValue(undefined),
      getAppDataFolder: mocks.getAppDataFolder,
      relocateAppDataFolder: vi.fn().mockResolvedValue(undefined),
    }),
    dialog: () => ({
      open: vi.fn().mockResolvedValue(null),
    }),
    events: () => ({
      emit: vi.fn().mockResolvedValue(undefined),
    }),
    models: () => ({
      stopAllModels: vi.fn().mockResolvedValue(undefined),
    }),
    opener: () => ({
      revealItemInDir: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}))

vi.mock('@/hooks/settings/useHardware', () => ({
  useHardware: () => ({
    pausePolling: mocks.pausePolling,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}))

describe('useGeneralSettingsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.getAppDataFolder.mockReturnValue(new Promise<string>(() => {}))
    mocks.writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.writeText,
      },
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps copied state visible for the latest copy action', async () => {
    const { result } = renderHook(() => useGeneralSettingsPage())

    await act(async () => {
      await result.current.copyToClipboard('first')
    })
    expect(result.current.isCopied).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await result.current.copyToClipboard('second')
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.isCopied).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.isCopied).toBe(false)
    expect(mocks.writeText).toHaveBeenNthCalledWith(1, 'first')
    expect(mocks.writeText).toHaveBeenNthCalledWith(2, 'second')
  })

  it('clears the copied reset timer on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { result, unmount } = renderHook(() => useGeneralSettingsPage())

    await act(async () => {
      await result.current.copyToClipboard('token')
    })

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  it('ignores app data folder load errors after unmount', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    let rejectLoad!: (error: Error) => void
    const loadPromise = new Promise<string>((_resolve, reject) => {
      rejectLoad = reject
    })
    mocks.getAppDataFolder.mockReturnValue(loadPromise)

    const { unmount } = renderHook(() => useGeneralSettingsPage())
    unmount()

    await act(async () => {
      rejectLoad(new Error('late load failure'))
      await loadPromise.catch(() => undefined)
    })

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
