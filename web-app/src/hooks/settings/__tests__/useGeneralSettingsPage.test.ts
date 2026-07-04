import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { useGeneralSettingsPage } from '../useGeneralSettingsPage'

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getAppDataFolder: vi.fn(),
  generalSettingState: {
    huggingfaceToken: '',
  },
  isDev: vi.fn(),
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
    window: () => ({
      openLogsWindow: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}))

vi.mock('@/hooks/updater/useAppUpdater', () => ({
  useAppUpdater: () => ({
    checkForUpdate: mocks.checkForUpdate,
  }),
}))

vi.mock('@/hooks/settings/useHardware', () => ({
  useHardware: () => ({
    pausePolling: mocks.pausePolling,
  }),
}))

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    huggingfaceToken: mocks.generalSettingState.huggingfaceToken,
  }),
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    isDev: mocks.isDev,
  }
})

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
    mocks.generalSettingState.huggingfaceToken = ''
    mocks.getAppDataFolder.mockReturnValue(new Promise<string>(() => {}))
    mocks.isDev.mockReturnValue(false)
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

  it('aborts Hugging Face token validation on unmount without stale toasts', async () => {
    mocks.generalSettingState.huggingfaceToken = 'hf_test'
    let validationSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          validationSignal = init?.signal
          validationSignal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result, unmount } = renderHook(() => useGeneralSettingsPage())
    let validatePromise!: Promise<void>

    await act(async () => {
      validatePromise = result.current.validateHuggingFaceToken()
      await Promise.resolve()
    })

    act(() => {
      unmount()
    })

    await act(async () => {
      await validatePromise
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://huggingface.co/api/whoami-v2',
      expect.objectContaining({
        headers: { Authorization: 'Bearer hf_test' },
        signal: validationSignal,
      })
    )
    expect(validationSignal?.aborted).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('ignores update check completion after unmount', async () => {
    let resolveUpdate!: (update: null) => void
    const updatePromise = new Promise<null>((resolve) => {
      resolveUpdate = resolve
    })
    mocks.checkForUpdate.mockReturnValue(updatePromise)

    const { result, unmount } = renderHook(() => useGeneralSettingsPage())
    let checkPromise!: Promise<void>

    await act(async () => {
      checkPromise = result.current.handleCheckForUpdate()
      await Promise.resolve()
    })

    expect(result.current.isCheckingUpdate).toBe(true)

    act(() => {
      unmount()
    })

    await act(async () => {
      resolveUpdate(null)
      await checkPromise
    })

    expect(mocks.checkForUpdate).toHaveBeenCalledWith(true)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })
})
