import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock ExtensionManager
const mockGetByName = vi.fn()
const mockListExtensions = vi.fn().mockReturnValue([])

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      getByName: mockGetByName,
      listExtensions: mockListExtensions,
    }),
  },
}))

vi.mock('@ax-studio/core', () => ({
  events: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}))

import { useBackendUpdater } from '../useBackendUpdater'
import type { BackendUpdateInfo } from '../useBackendUpdater'
import { events } from '@ax-studio/core'

describe('useBackendUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetByName.mockReturnValue(null)
    mockListExtensions.mockReturnValue([])
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useBackendUpdater())

    expect(result.current.updateState).toEqual({
      isUpdateAvailable: false,
      updateInfo: null,
      isUpdating: false,
      remindMeLater: false,
      autoUpdateEnabled: false,
    })
  })

  it('should set up event listener for state sync', () => {
    renderHook(() => useBackendUpdater())

    expect(events.on).toHaveBeenCalledWith(
      'onBackendUpdateStateSync',
      expect.any(Function)
    )
  })

  it('should clean up event listener on unmount', () => {
    const { unmount } = renderHook(() => useBackendUpdater())

    unmount()

    expect(events.off).toHaveBeenCalledWith(
      'onBackendUpdateStateSync',
      expect.any(Function)
    )
  })

  it('should sync state when event is received', () => {
    const { result } = renderHook(() => useBackendUpdater())

    const syncHandler = (events.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === 'onBackendUpdateStateSync'
    )?.[1]

    act(() => {
      syncHandler({ isUpdateAvailable: true, remindMeLater: true })
    })

    expect(result.current.updateState.isUpdateAvailable).toBe(true)
    expect(result.current.updateState.remindMeLater).toBe(true)
  })

  describe('checkForUpdate', () => {
    it('should return null when extension is not found', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGetByName.mockReturnValue(null)

      const { result } = renderHook(() => useBackendUpdater())

      let updateResult: BackendUpdateInfo | null | undefined
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(updateResult).toBe(null)
      consoleErrorSpy.mockRestore()
    })

    it('should detect available update', async () => {
      const updateInfo: BackendUpdateInfo = {
        updateNeeded: true,
        newVersion: 'b8000',
        currentVersion: 'b7524',
      }

      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockResolvedValue(updateInfo),
        getSettings: vi.fn().mockResolvedValue([]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      let updateResult: BackendUpdateInfo | null | undefined
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(updateResult).toEqual(updateInfo)
      expect(result.current.updateState.isUpdateAvailable).toBe(true)
      expect(result.current.updateState.updateInfo).toEqual(updateInfo)
      expect(events.emit).toHaveBeenCalledWith(
        'onBackendUpdateStateSync',
        expect.objectContaining({ isUpdateAvailable: true })
      )
    })

    it('should report no update when updateNeeded is false', async () => {
      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockResolvedValue({
          updateNeeded: false,
          newVersion: 'b7524',
        }),
        getSettings: vi.fn().mockResolvedValue([]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      let updateResult: BackendUpdateInfo | null | undefined
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(updateResult).toBe(null)
      expect(result.current.updateState.isUpdateAvailable).toBe(false)
    })

    it('should reset remindMeLater when requested', async () => {
      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockResolvedValue({
          updateNeeded: false,
          newVersion: 'b7524',
        }),
        getSettings: vi.fn().mockResolvedValue([]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      // Set remindMeLater first
      act(() => {
        result.current.setRemindMeLater(true)
      })

      expect(result.current.updateState.remindMeLater).toBe(true)

      await act(async () => {
        await result.current.checkForUpdate(true)
      })

      expect(result.current.updateState.remindMeLater).toBe(false)
    })

    it('should handle errors during check', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockRejectedValue(new Error('Network error')),
        getSettings: vi.fn().mockResolvedValue([]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      let updateResult: BackendUpdateInfo | null | undefined
      await act(async () => {
        updateResult = await result.current.checkForUpdate()
      })

      expect(updateResult).toBe(null)
      expect(result.current.updateState.isUpdateAvailable).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('setRemindMeLater', () => {
    it('should update state and emit sync event', () => {
      const { result } = renderHook(() => useBackendUpdater())

      act(() => {
        result.current.setRemindMeLater(true)
      })

      expect(result.current.updateState.remindMeLater).toBe(true)
      expect(events.emit).toHaveBeenCalledWith('onBackendUpdateStateSync', {
        remindMeLater: true,
      })
    })
  })

  describe('updateBackend', () => {
    it('should do nothing when updateInfo is null', async () => {
      const { result } = renderHook(() => useBackendUpdater())

      await act(async () => {
        await result.current.updateBackend()
      })

      // No errors, no state change
      expect(result.current.updateState.isUpdating).toBe(false)
    })

    it('should perform update when updateInfo is available', async () => {
      const mockUpdateBackend = vi.fn().mockResolvedValue({
        wasUpdated: true,
        newBackend: 'b8000_linux-cuda-12-common_cpus-x64',
      })

      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockResolvedValue({
          updateNeeded: true,
          newVersion: 'b8000',
        }),
        getSettings: vi.fn().mockResolvedValue([
          {
            key: 'version_backend',
            controller_props: {
              value: 'b7524_linux-cuda-12-common_cpus-x64',
            },
          },
        ]),
        updateBackend: mockUpdateBackend,
      })

      const { result } = renderHook(() => useBackendUpdater())

      // First check for update
      await act(async () => {
        await result.current.checkForUpdate()
      })

      expect(result.current.updateState.isUpdateAvailable).toBe(true)

      // Then perform update
      await act(async () => {
        await result.current.updateBackend()
      })

      expect(mockUpdateBackend).toHaveBeenCalledWith(
        'b8000_linux-cuda-12-common_cpus-x64'
      )
      expect(result.current.updateState.isUpdating).toBe(false)
      expect(result.current.updateState.isUpdateAvailable).toBe(false)
    })

    it('should throw when wasUpdated is false', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockResolvedValue({
          updateNeeded: true,
          newVersion: 'b8000',
        }),
        getSettings: vi.fn().mockResolvedValue([
          {
            key: 'version_backend',
            controller_props: { value: 'b7524_linux-cpu' },
          },
        ]),
        updateBackend: vi.fn().mockResolvedValue({ wasUpdated: false }),
      })

      const { result } = renderHook(() => useBackendUpdater())

      await act(async () => {
        await result.current.checkForUpdate()
      })

      await expect(
        act(async () => {
          await result.current.updateBackend()
        })
      ).rejects.toThrow('Backend update reported wasUpdated=false')

      expect(result.current.updateState.isUpdating).toBe(false)
      consoleErrorSpy.mockRestore()
    })

    it('should throw when current backend setting is not found', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockGetByName.mockReturnValue({
        checkBackendForUpdates: vi.fn().mockResolvedValue({
          updateNeeded: true,
          newVersion: 'b8000',
        }),
        getSettings: vi.fn().mockResolvedValue([]),
        updateBackend: vi.fn(),
      })

      const { result } = renderHook(() => useBackendUpdater())

      await act(async () => {
        await result.current.checkForUpdate()
      })

      await expect(
        act(async () => {
          await result.current.updateBackend()
        })
      ).rejects.toThrow('Current backend version not found in extension settings')

      consoleErrorSpy.mockRestore()
    })
  })

  describe('installBackend', () => {
    it('should install and configure backend', async () => {
      const mockInstallBackend = vi.fn().mockResolvedValue(undefined)
      const mockConfigureBackends = vi.fn().mockResolvedValue(undefined)

      mockGetByName.mockReturnValue({
        installBackend: mockInstallBackend,
        configureBackends: mockConfigureBackends,
        getSettings: vi.fn().mockResolvedValue([]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      await act(async () => {
        await result.current.installBackend('/path/to/backend.tar.gz')
      })

      expect(mockInstallBackend).toHaveBeenCalledWith('/path/to/backend.tar.gz')
      expect(mockConfigureBackends).toHaveBeenCalled()
    })

    it('should throw when extension does not support installBackend', async () => {
      mockGetByName.mockReturnValue({
        getSettings: vi.fn().mockResolvedValue([]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      await expect(
        act(async () => {
          await result.current.installBackend('/path/to/file.zip')
        })
      ).rejects.toThrow('LlamaCpp extension does not support installBackend')
    })
  })

  describe('autoUpdateEnabled', () => {
    it('should read auto_update_engine setting on mount', async () => {
      mockGetByName.mockReturnValue({
        getSettings: vi.fn().mockResolvedValue([
          {
            key: 'auto_update_engine',
            controller_props: { value: true },
          },
        ]),
      })

      const { result } = renderHook(() => useBackendUpdater())

      // Wait for useEffect to complete
      await act(async () => {
        await vi.dynamicImportSettled()
      })

      // The auto-update check runs in a useEffect, need to wait
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(result.current.updateState.autoUpdateEnabled).toBe(true)
    })
  })

  describe('getLlamacppExtension fallback', () => {
    it('should find extension by constructor name heuristic', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGetByName.mockReturnValue(null)

      class LlamacppExtension {
        checkBackendForUpdates = vi.fn().mockResolvedValue({
          updateNeeded: false,
          newVersion: 'b7524',
        })
        getSettings = vi.fn().mockResolvedValue([])
      }

      mockListExtensions.mockReturnValue([new LlamacppExtension()])

      const { result } = renderHook(() => useBackendUpdater())

      await act(async () => {
        await result.current.checkForUpdate()
      })

      // Should not have logged "Extension missing" since it was found by heuristic
      const missingCalls = consoleErrorSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('Extension missing')
      )
      expect(missingCalls).toHaveLength(0)
      consoleErrorSpy.mockRestore()
    })
  })
})
