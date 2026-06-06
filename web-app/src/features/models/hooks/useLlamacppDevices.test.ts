import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useLlamacppDevices } from './useLlamacppDevices'
import { useModelProvider } from './useModelProvider'
import { getServiceHub } from '@/hooks/useServiceHub'

// Stable mock objects so the same instance is returned across calls
const mockGetLlamacppDevices = vi.fn().mockResolvedValue([])
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined)

const mockHardwareService = {
  getHardwareInfo: vi.fn().mockResolvedValue(null),
  getSystemUsage: vi.fn().mockResolvedValue(null),
  getLlamacppDevices: mockGetLlamacppDevices,
  setActiveGpus: vi.fn().mockResolvedValue(undefined),
  getGpuInfo: vi.fn().mockResolvedValue([]),
  getCpuInfo: vi.fn().mockResolvedValue({}),
  getMemoryInfo: vi.fn().mockResolvedValue({}),
}

const mockProvidersService = {
  getProviders: vi.fn().mockResolvedValue([]),
  createProvider: vi.fn().mockResolvedValue({ id: 'test-provider' }),
  deleteProvider: vi.fn().mockResolvedValue(undefined),
  updateProvider: vi.fn().mockResolvedValue(undefined),
  getProvider: vi.fn().mockResolvedValue(null),
  fetchModelsFromProvider: vi.fn().mockResolvedValue([]),
  updateSettings: mockUpdateSettings,
}

// Override the module-level mocks to return stable objects
vi.mock('@/hooks/useServiceHub', async () => {
  return {
    useServiceHub: () => ({
      hardware: () => mockHardwareService,
      providers: () => mockProvidersService,
    }),
    getServiceHub: () => ({
      hardware: () => mockHardwareService,
      providers: () => mockProvidersService,
    }),
    initializeServiceHubStore: vi.fn(),
    isServiceHubInitialized: () => true,
  }
})

describe('useLlamacppDevices', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store
    act(() => {
      useLlamacppDevices.setState({
        devices: [],
        loading: false,
        error: null,
      })
    })

    // Reset model provider store
    act(() => {
      useModelProvider.setState({
        providers: [],
      })
    })
  })

  // --- Default state ---

  it('should initialize with empty devices', () => {
    expect(useLlamacppDevices.getState().devices).toEqual([])
  })

  it('should initialize with loading=false', () => {
    expect(useLlamacppDevices.getState().loading).toBe(false)
  })

  it('should initialize with error=null', () => {
    expect(useLlamacppDevices.getState().error).toBe(null)
  })

  // --- clearError ---

  it('should clear error', () => {
    act(() => {
      useLlamacppDevices.setState({ error: 'some error' })
    })
    act(() => {
      useLlamacppDevices.getState().clearError()
    })
    expect(useLlamacppDevices.getState().error).toBe(null)
  })

  // --- setDevices ---

  it('should set devices directly', () => {
    const devices = [
      { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
    ]
    act(() => {
      useLlamacppDevices.getState().setDevices(devices)
    })
    expect(useLlamacppDevices.getState().devices).toEqual(devices)
  })

  // --- fetchDevices ---

  it('should set loading=true during fetch', async () => {
    mockGetLlamacppDevices.mockResolvedValue([])

    let loadingDuringFetch = false
    const unsubscribe = useLlamacppDevices.subscribe((state) => {
      if (state.loading) loadingDuringFetch = true
    })

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    unsubscribe()
    expect(loadingDuringFetch).toBe(true)
    expect(useLlamacppDevices.getState().loading).toBe(false)
  })

  it('should fetch devices and mark all activated when no device setting exists', async () => {
    mockGetLlamacppDevices.mockResolvedValue([
      { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: false },
      { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: false },
    ])

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    const devices = useLlamacppDevices.getState().devices
    expect(devices).toHaveLength(2)
    expect(devices[0].activated).toBe(true)
    expect(devices[1].activated).toBe(true)
  })

  it('should fetch devices and respect existing device setting', async () => {
    mockGetLlamacppDevices.mockResolvedValue([
      { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: false },
      { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: false },
    ])

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'device',
                controller_props: { value: 'gpu-0' },
              },
            ],
          },
        ] as never,
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    const devices = useLlamacppDevices.getState().devices
    expect(devices[0].activated).toBe(true)
    expect(devices[1].activated).toBe(false)
  })

  it('should activate all devices when device setting is empty string', async () => {
    mockGetLlamacppDevices.mockResolvedValue([
      { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: false },
    ])

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'device',
                controller_props: { value: '' },
              },
            ],
          },
        ] as never,
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    expect(useLlamacppDevices.getState().devices[0].activated).toBe(true)
  })

  it('should handle fetch error and set error message', async () => {
    mockGetLlamacppDevices.mockRejectedValue(new Error('Network failure'))

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    expect(useLlamacppDevices.getState().error).toBe('Network failure')
    expect(useLlamacppDevices.getState().loading).toBe(false)
  })

  it('should set generic error message for non-Error throws', async () => {
    mockGetLlamacppDevices.mockRejectedValue('string error')

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    expect(useLlamacppDevices.getState().error).toBe('Failed to fetch devices')
  })

  it('should parse comma-separated device settings with whitespace', async () => {
    mockGetLlamacppDevices.mockResolvedValue([
      { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: false },
      { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: false },
      { id: 'gpu-2', name: 'GPU 2', mem: 4096, free: 2048, activated: false },
    ])

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'device',
                controller_props: { value: 'gpu-0, gpu-2' },
              },
            ],
          },
        ] as never,
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().fetchDevices()
    })

    const devices = useLlamacppDevices.getState().devices
    expect(devices[0].activated).toBe(true)
    expect(devices[1].activated).toBe(false)
    expect(devices[2].activated).toBe(true)
  })

  // --- toggleDevice ---

  it('should optimistically toggle device activation', () => {
    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
          { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: true },
        ],
      })
    })

    act(() => {
      useLlamacppDevices.getState().toggleDevice('gpu-0')
    })

    const devices = useLlamacppDevices.getState().devices
    expect(devices[0].activated).toBe(false)
    expect(devices[1].activated).toBe(true)
  })

  it('should not modify other devices when toggling', () => {
    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
          { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: false },
        ],
      })
    })

    act(() => {
      useLlamacppDevices.getState().toggleDevice('gpu-0')
    })

    expect(useLlamacppDevices.getState().devices[1].activated).toBe(false)
  })

  it('should persist device setting via providers updateSettings', async () => {
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'device',
                controller_props: { value: '' },
              },
              {
                key: 'other',
                controller_props: { value: 'keep' },
              },
            ],
          },
        ] as never,
      })
    })

    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
          { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: true },
        ],
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().toggleDevice('gpu-1')
    })

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      'llamacpp',
      expect.arrayContaining([
        expect.objectContaining({
          key: 'device',
          controller_props: expect.objectContaining({ value: 'gpu-0' }),
        }),
      ])
    )
  })

  it('should set empty device string when all devices are activated', async () => {
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'device',
                controller_props: { value: 'gpu-0' },
              },
            ],
          },
        ] as never,
      })
    })

    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
          { id: 'gpu-1', name: 'GPU 1', mem: 4096, free: 2048, activated: false },
        ],
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().toggleDevice('gpu-1')
    })

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      'llamacpp',
      expect.arrayContaining([
        expect.objectContaining({
          key: 'device',
          controller_props: expect.objectContaining({ value: '' }),
        }),
      ])
    )
  })

  it('should skip persistence when llamacpp provider not found', async () => {
    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
        ],
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().toggleDevice('gpu-0')
    })

    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  it('should handle toggleDevice for non-existent deviceId gracefully', () => {
    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
        ],
      })
    })

    act(() => {
      useLlamacppDevices.getState().toggleDevice('non-existent')
    })

    expect(useLlamacppDevices.getState().devices[0].activated).toBe(true)
  })

  it('should not throw when updateSettings rejects', async () => {
    mockUpdateSettings.mockRejectedValueOnce(new Error('persist failed'))

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'device',
                controller_props: { value: '' },
              },
            ],
          },
        ] as never,
      })
    })

    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
        ],
      })
    })

    await expect(
      act(async () => {
        await useLlamacppDevices.getState().toggleDevice('gpu-0')
      })
    ).resolves.not.toThrow()

    // Optimistic update still applied
    expect(useLlamacppDevices.getState().devices[0].activated).toBe(false)
  })

  it('should preserve non-device settings when persisting', async () => {
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'llamacpp',
            settings: [
              {
                key: 'threads',
                controller_props: { value: 8 },
              },
              {
                key: 'device',
                controller_props: { value: '' },
              },
            ],
          },
        ] as never,
      })
    })

    act(() => {
      useLlamacppDevices.setState({
        devices: [
          { id: 'gpu-0', name: 'GPU 0', mem: 8192, free: 4096, activated: true },
        ],
      })
    })

    await act(async () => {
      await useLlamacppDevices.getState().toggleDevice('gpu-0')
    })

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      'llamacpp',
      expect.arrayContaining([
        expect.objectContaining({
          key: 'threads',
          controller_props: expect.objectContaining({ value: 8 }),
        }),
      ])
    )
  })
})
