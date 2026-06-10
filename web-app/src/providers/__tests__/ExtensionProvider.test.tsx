import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionProvider } from '../ExtensionProvider'

const mocks = vi.hoisted(() => {
  const extensionManager = {
    load: vi.fn(),
    registerActive: vi.fn(),
    unload: vi.fn(),
  }
  const listen = vi.fn()
  const core: Record<string, unknown> = {}
  const ExtensionManager = vi.fn(() => extensionManager) as unknown as {
    (): typeof extensionManager
    getInstance: ReturnType<typeof vi.fn>
  }
  ExtensionManager.getInstance = vi.fn(() => extensionManager)

  return {
    core,
    extensionManager,
    listen,
    serviceHub: {
      events: () => ({
        listen,
      }),
    },
    ExtensionManager,
    EngineManager: vi.fn(),
    ModelManager: vi.fn(),
    events: {
      emit: vi.fn(),
    },
  }
})

vi.mock('@/lib/bootstrap/core-bridge', () => ({
  ensureCoreBridge: () => mocks.core,
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: mocks.ExtensionManager,
}))

vi.mock('@ax-studio/core', () => ({
  AppEvent: {
    onModelImported: 'onModelImported',
  },
  EngineManager: mocks.EngineManager,
  events: mocks.events,
  ModelManager: mocks.ModelManager,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => mocks.serviceHub,
}))

describe('ExtensionProvider', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mocks.core)) {
      delete mocks.core[key]
    }
    mocks.extensionManager.registerActive.mockResolvedValue(undefined)
    mocks.extensionManager.load.mockResolvedValue(undefined)
    mocks.listen.mockResolvedValue(vi.fn())
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleInfoSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('renders children immediately while extensions load in the background', async () => {
    let resolveRegister: (() => void) | undefined
    mocks.extensionManager.registerActive.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRegister = resolve
      })
    )

    render(
      <ExtensionProvider>
        <div data-testid="child">App shell</div>
      </ExtensionProvider>
    )

    expect(screen.getByTestId('child')).toHaveTextContent('App shell')

    await waitFor(() => {
      expect(mocks.extensionManager.registerActive).toHaveBeenCalled()
    })

    resolveRegister?.()

    await waitFor(() => {
      expect(mocks.events.emit).toHaveBeenCalledWith('onModelImported', {
        source: 'extensions-ready',
      })
    })
  })

  it('creates core managers synchronously before children use them', () => {
    render(
      <ExtensionProvider>
        <div data-testid="child">App shell</div>
      </ExtensionProvider>
    )

    expect(mocks.core.extensionManager).toBe(mocks.extensionManager)
    expect(mocks.EngineManager).toHaveBeenCalled()
    expect(mocks.ModelManager).toHaveBeenCalled()
  })

  it('keeps the app rendered if extension startup fails', async () => {
    mocks.extensionManager.registerActive.mockRejectedValue(new Error('extension boom'))

    render(
      <ExtensionProvider>
        <div data-testid="child">App shell</div>
      </ExtensionProvider>
    )

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Extension setup failed, rendering app anyway:',
        expect.any(Error)
      )
    })

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('refreshes active extensions when background install completes', async () => {
    let onExtensionsUpdated: (() => void) | undefined
    mocks.listen.mockImplementation(async (_event, handler) => {
      onExtensionsUpdated = handler
      return vi.fn()
    })

    render(
      <ExtensionProvider>
        <div data-testid="child">App shell</div>
      </ExtensionProvider>
    )

    await waitFor(() => {
      expect(mocks.extensionManager.registerActive).toHaveBeenCalledTimes(1)
    })

    onExtensionsUpdated?.()

    await waitFor(() => {
      expect(mocks.extensionManager.registerActive).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(mocks.events.emit).toHaveBeenCalledWith('onModelImported', {
        source: 'extensions-updated',
      })
    })
  })
})
