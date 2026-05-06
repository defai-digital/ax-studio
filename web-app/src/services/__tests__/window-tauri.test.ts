import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowConfig } from '../window/types'

const mocks = vi.hoisted(() => ({
  constructedWindows: [] as MockWebviewWindow[],
  getByLabel: vi.fn(),
  listen: vi.fn(),
}))

class MockWebviewWindow {
  static getByLabel = mocks.getByLabel

  label: string
  options: Record<string, unknown>
  close = vi.fn().mockResolvedValue(undefined)
  show = vi.fn().mockResolvedValue(undefined)
  hide = vi.fn().mockResolvedValue(undefined)
  setFocus = vi.fn().mockResolvedValue(undefined)
  setTitle = vi.fn().mockResolvedValue(undefined)
  setTheme = vi.fn().mockResolvedValue(undefined)
  onCloseRequested = vi.fn().mockResolvedValue(() => {})

  constructor(label: string, options: Record<string, unknown>) {
    this.label = label
    this.options = options
    mocks.constructedWindows.push(this)
  }
}

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: MockWebviewWindow,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}))

async function createService() {
  const { TauriWindowService } = await import('../window/tauri')
  return new TauriWindowService()
}

const baseConfig: WindowConfig = {
  label: 'logs-app-window',
  url: '/logs',
  title: 'Logs',
  width: 800,
  height: 600,
  center: true,
  resizable: true,
}

describe('TauriWindowService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.constructedWindows.length = 0
    mocks.getByLabel.mockResolvedValue(null)
    mocks.listen.mockResolvedValue(vi.fn())
    localStorage.clear()
  })

  it('creates a webview window with a persisted dark theme', async () => {
    const service = await createService()
    localStorage.setItem(
      'theme',
      JSON.stringify({ state: { activeTheme: 'dark', isDark: true } })
    )

    const created = await service.createWebviewWindow(baseConfig)

    expect(created.label).toBe('logs-app-window')
    expect(mocks.constructedWindows[0].options).toEqual(
      expect.objectContaining({
        url: '/logs',
        title: 'Logs',
        width: 800,
        height: 600,
        center: true,
        resizable: true,
        theme: 'dark',
      })
    )
  })

  it('leaves theme undefined for malformed persisted theme data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await createService()
    localStorage.setItem('theme', 'not-json')

    await service.createWebviewWindow(baseConfig)

    expect(mocks.constructedWindows[0].options.theme).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to parse theme from localStorage:',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })

  it('wraps a created window with the public window service API', async () => {
    const service = await createService()

    const created = await service.createWebviewWindow(baseConfig)
    const rawWindow = mocks.constructedWindows[0]
    await created.show()
    await created.hide()
    await created.focus()
    await created.setTitle('New title')
    await created.close()

    expect(rawWindow.show).toHaveBeenCalled()
    expect(rawWindow.hide).toHaveBeenCalled()
    expect(rawWindow.setFocus).toHaveBeenCalled()
    expect(rawWindow.setTitle).toHaveBeenCalledWith('New title')
    expect(rawWindow.close).toHaveBeenCalled()
  })

  it('returns an existing window by label with wrapped controls', async () => {
    const service = await createService()
    const existingWindow = new MockWebviewWindow('existing', {})
    mocks.getByLabel.mockResolvedValue(existingWindow)

    const existing = await service.getWebviewWindowByLabel('existing')
    await existing?.show()
    await existing?.focus()

    expect(mocks.getByLabel).toHaveBeenCalledWith('existing')
    expect(existing?.label).toBe('existing')
    expect(existingWindow.show).toHaveBeenCalled()
    expect(existingWindow.setFocus).toHaveBeenCalled()
  })

  it('reuses and focuses an existing window instead of creating another one', async () => {
    const service = await createService()
    const show = vi.fn().mockResolvedValue(undefined)
    const focus = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(service, 'getWebviewWindowByLabel').mockResolvedValue({
      label: baseConfig.label,
      show,
      focus,
      close: vi.fn(),
      hide: vi.fn(),
      setTitle: vi.fn(),
    })
    const createSpy = vi.spyOn(service, 'createWebviewWindow')

    await service.openWindow(baseConfig)

    expect(show).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('creates a new window when no existing window is found', async () => {
    const service = await createService()
    const createSpy = vi.spyOn(service, 'createWebviewWindow')

    await service.openWindow(baseConfig)

    expect(createSpy).toHaveBeenCalledWith(baseConfig)
  })

  it('opens named utility windows with their expected route labels', async () => {
    const service = await createService()
    const openWindowSpy = vi
      .spyOn(service, 'openWindow')
      .mockResolvedValue(undefined)

    await service.openLogsWindow()
    await service.openSystemMonitorWindow()
    await service.openLocalApiServerLogsWindow()

    expect(openWindowSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: '/logs', label: 'logs-app-window' })
    )
    expect(openWindowSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: '/system-monitor',
        label: 'system-monitor-window',
      })
    )
    expect(openWindowSpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: '/local-api-server/logs',
        label: 'logs-window-local-api-server',
      })
    )
  })

  it('applies theme-changed events and unregisters the listener on window close', async () => {
    const unlisten = vi.fn()
    let themeHandler: ((event: { payload: string }) => Promise<void>) | undefined
    mocks.listen.mockImplementation(async (_eventName, handler) => {
      themeHandler = handler
      return unlisten
    })
    const service = await createService()

    await service.createWebviewWindow(baseConfig)
    const rawWindow = mocks.constructedWindows[0]
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledWith('theme-changed', expect.any(Function)))
    await themeHandler?.({ payload: 'dark' })
    await themeHandler?.({ payload: 'light' })
    await themeHandler?.({ payload: 'auto' })
    const closeHandler = rawWindow.onCloseRequested.mock.calls[0][0]
    closeHandler()

    expect(rawWindow.setTheme).toHaveBeenNthCalledWith(1, 'dark')
    expect(rawWindow.setTheme).toHaveBeenNthCalledWith(2, 'light')
    expect(rawWindow.setTheme).toHaveBeenNthCalledWith(3, null)
    expect(unlisten).toHaveBeenCalled()
  })
})

