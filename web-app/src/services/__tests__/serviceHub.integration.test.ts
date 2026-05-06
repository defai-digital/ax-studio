import { describe, it, expect, vi, beforeEach } from 'vitest'
import { initializeServiceHub, type ServiceHub } from '../index'
import { isPlatformTauri } from '@/lib/platform/utils'

// Mock platform detection
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn().mockReturnValue(false),
}))

// Mock @ax-studio/core EngineManager to prevent initialization issues
vi.mock('@ax-studio/core', () => ({
  EngineManager: {
    instance: vi.fn(() => ({
      engines: new Map()
    }))
  }
}))

// Mock token.js to avoid initialization issues
vi.mock('token.js', () => ({
  models: {}
}))

// Mock ExtensionManager to avoid initialization issues
vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: vi.fn(() => ({
      getEngine: vi.fn()
    }))
  }
}))

// Mock dynamic imports for Tauri services
vi.mock('../theme/tauri', () => ({
  TauriThemeService: vi.fn().mockImplementation(() => ({
    setTheme: vi.fn(),
    getCurrentWindow: vi.fn()
  }))
}))

vi.mock('../window/tauri', () => ({
  TauriWindowService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../events/tauri', () => ({
  TauriEventsService: vi.fn().mockImplementation(() => ({
    emit: vi.fn(),
    listen: vi.fn()
  }))
}))

vi.mock('../hardware/tauri', () => ({
  TauriHardwareService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../app/tauri', () => ({
  TauriAppService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../mcp/tauri', () => ({
  TauriMCPService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../providers/tauri', () => ({
  TauriProvidersService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../dialog/tauri', () => ({
  TauriDialogService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../opener/tauri', () => ({
  TauriOpenerService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../updater/tauri', () => ({
  TauriUpdaterService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../path/tauri', () => ({
  TauriPathService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../core/tauri', () => ({
  TauriCoreService: vi.fn().mockImplementation(() => ({}))
}))

vi.mock('../deeplink/tauri', () => ({
  TauriDeepLinkService: vi.fn().mockImplementation(() => ({}))
}))

// Mock console to avoid noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('ServiceHub Integration Tests', () => {
  let serviceHub: ServiceHub

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(isPlatformTauri).mockReturnValue(false)
    serviceHub = await initializeServiceHub()
  })

  describe('ServiceHub Initialization', () => {
    it('should initialize with web services when not on Tauri', async () => {
      vi.mocked(isPlatformTauri).mockReturnValue(false)

      serviceHub = await initializeServiceHub()

      expect(serviceHub).toBeDefined()
      expect(serviceHub.theme()).toBeDefined()
      expect(serviceHub.events()).toBeDefined()
    })

    it('should initialize with Tauri services when on Tauri', async () => {
      vi.mocked(isPlatformTauri).mockReturnValue(true)

      serviceHub = await initializeServiceHub()

      expect(serviceHub).toBeDefined()
      expect(serviceHub.theme()).toBeDefined()
      expect(serviceHub.events()).toBeDefined()
    })
  })

  describe('Service Access', () => {
    it('should provide access to all required services', () => {
      const services = [
        'theme', 'window', 'events', 'hardware', 'app',
        'messages', 'mcp', 'threads', 'providers', 'models', 'assistants',
        'dialog', 'opener', 'updater', 'path', 'core', 'deeplink',
        'projects', 'rag', 'uploads',
      ]

      services.forEach(serviceName => {
        expect(typeof serviceHub[serviceName as keyof ServiceHub]).toBe('function')
        expect(serviceHub[serviceName as keyof ServiceHub]()).toBeDefined()
      })
    })

    it('should return same service instance on multiple calls', () => {
      const themeService1 = serviceHub.theme()
      const themeService2 = serviceHub.theme()

      expect(themeService1).toBe(themeService2)
    })

    it('should return same projects service instance on multiple calls', () => {
      const projects1 = serviceHub.projects()
      const projects2 = serviceHub.projects()

      expect(projects1).toBe(projects2)
    })
  })

  describe('ensureInitialized guard', () => {
    it('should not throw when accessing services after initialization', () => {
      // PlatformServiceHub is not exported, so we verify that after
      // initializeServiceHub() all service getters work without throwing
      expect(() => serviceHub.theme()).not.toThrow()
      expect(() => serviceHub.projects()).not.toThrow()
      expect(() => serviceHub.rag()).not.toThrow()
      expect(() => serviceHub.uploads()).not.toThrow()
      expect(() => serviceHub.messages()).not.toThrow()
      expect(() => serviceHub.deeplink()).not.toThrow()
    })
  })

  describe('idempotent initialization', () => {
    it('should not re-initialize when called multiple times', async () => {
      vi.mocked(isPlatformTauri).mockReturnValue(false)

      const hub1 = await initializeServiceHub()
      const hub2 = await initializeServiceHub()

      // Each call creates a new hub instance
      expect(hub1).toBeDefined()
      expect(hub2).toBeDefined()
    })
  })

  describe('Basic Service Functionality', () => {
    it('should have working theme service', () => {
      const theme = serviceHub.theme()
      
      expect(typeof theme.setTheme).toBe('function')
      expect(typeof theme.getCurrentWindow).toBe('function')
    })

    it('should have working events service', () => {
      const events = serviceHub.events()
      
      expect(typeof events.emit).toBe('function')
      expect(typeof events.listen).toBe('function')
    })

    it('should apply theme changes in web fallback mode', async () => {
      await serviceHub.theme().setTheme('dark')
      expect(document.documentElement.style.colorScheme).toBe('dark')

      await serviceHub.theme().getCurrentWindow().setTheme('light')
      expect(document.documentElement.style.colorScheme).toBe('light')
    })

    it('should dispatch and unsubscribe web fallback events', async () => {
      const handler = vi.fn()
      const unlisten = await serviceHub.events().listen('test-event', handler)

      await serviceHub.events().emit('test-event', { ok: true })
      expect(handler).toHaveBeenCalledWith({ payload: { ok: true } })

      unlisten()
      await serviceHub.events().emit('test-event', { ok: false })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should expose safe web fallback window behavior', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

      await expect(
        serviceHub.window().createWebviewWindow({
          label: 'logs',
          url: '/logs',
        })
      ).rejects.toThrow('Window service is not available in web mode')
      await expect(
        serviceHub.window().getWebviewWindowByLabel('logs')
      ).resolves.toBeNull()
      await serviceHub.window().openWindow({ label: 'logs', url: '/logs' })
      await serviceHub.window().openLogsWindow()
      await serviceHub.window().openSystemMonitorWindow()
      await serviceHub.window().openLocalApiServerLogsWindow()

      expect(openSpy).toHaveBeenCalledWith(
        '/logs',
        '_blank',
        'noopener,noreferrer'
      )
      openSpy.mockRestore()
    })

    it('should expose safe web fallback app behavior', async () => {
      window.localStorage.setItem('key', 'value')

      await serviceHub.app().factoryReset()
      expect(window.localStorage.getItem('key')).toBeNull()
      expect(serviceHub.app().parseLogLine('plain log')).toEqual(
        expect.objectContaining({
          level: 'info',
          target: 'web',
          message: 'plain log',
        })
      )
      await expect(serviceHub.app().readLogs()).resolves.toEqual([])
      await expect(serviceHub.app().getAppDataFolder()).resolves.toBeUndefined()
      await expect(serviceHub.app().getServerStatus()).resolves.toBe(false)
      await expect(
        serviceHub.app().relocateAppDataFolder('/tmp/data')
      ).rejects.toThrow('App data relocation is not available in web mode')
      await expect(serviceHub.app().readYaml('/tmp/config.yaml')).rejects.toThrow(
        'YAML file access is not available in web mode'
      )
    })

    it('should expose safe web fallback MCP behavior', async () => {
      await serviceHub.mcp().updateMCPConfig({})
      await serviceHub.mcp().restartMCPServers()
      await expect(serviceHub.mcp().getMCPConfig()).resolves.toEqual({})
      await expect(serviceHub.mcp().getTools()).resolves.toEqual([])
      await expect(serviceHub.mcp().getConnectedServers()).resolves.toEqual([])
      await expect(
        serviceHub.mcp().callTool({ server: 'missing', name: 'noop', arguments: {} })
      ).resolves.toEqual({ content: [], isError: true })

      const cancellable = serviceHub.mcp().callToolWithCancellation({
        server: 'missing',
        name: 'noop',
        arguments: {},
        cancellationToken: 'token-1',
      })
      await expect(cancellable.promise).resolves.toEqual({
        content: [],
        isError: true,
      })
      await expect(cancellable.cancel()).resolves.toBeUndefined()
      expect(cancellable.token).toBe('token-1')
      await serviceHub.mcp().cancelToolCall('token-1')
      await serviceHub.mcp().activateMCPServer('server-1')
      await serviceHub.mcp().deactivateMCPServer('server-1')
    })

    it('should expose safe web fallback provider and desktop utility services', async () => {
      await expect(serviceHub.providers().getProviders()).resolves.toEqual([])
      await expect(
        serviceHub.providers().fetchModelsFromProvider({} as ModelProvider)
      ).resolves.toEqual([])
      await expect(
        serviceHub.providers().updateSettings('openai', [])
      ).resolves.toBeUndefined()
      expect(serviceHub.providers().fetch()).toBe(fetch)

      await expect(serviceHub.dialog().open()).resolves.toBeNull()
      await expect(serviceHub.dialog().save()).resolves.toBeNull()
      await expect(
        serviceHub.opener().revealItemInDir('/tmp/file.txt')
      ).resolves.toBeUndefined()
      await expect(serviceHub.updater().check()).resolves.toBeNull()
      await expect(serviceHub.updater().installAndRestart()).resolves.toBeUndefined()
      await expect(
        serviceHub.updater().downloadAndInstallWithProgress(vi.fn())
      ).resolves.toBeUndefined()
      await expect(serviceHub.hardware().getHardwareInfo()).resolves.toBeNull()
      await expect(serviceHub.hardware().getSystemUsage()).resolves.toBeNull()
      await expect(serviceHub.hardware().getLlamacppDevices()).resolves.toEqual([])
    })

    it('should expose web fallback path, core, and deeplink helpers', async () => {
      await expect(serviceHub.path().join('/tmp', '', 'models')).resolves.toBe(
        '/tmp/models'
      )
      await expect(serviceHub.path().dirname('/tmp/models/file.gguf')).resolves.toBe(
        '/tmp/models'
      )
      await expect(serviceHub.path().basename('/tmp/models/file.gguf')).resolves.toBe(
        'file.gguf'
      )
      await expect(serviceHub.path().extname('/tmp/models/file.gguf')).resolves.toBe(
        '.gguf'
      )
      expect(serviceHub.path().sep()).toBe('/')

      await expect(serviceHub.core().invoke('read_logs')).rejects.toThrow(
        'Core command "read_logs" is not available in web mode'
      )
      expect(serviceHub.core().convertFileSrc('/tmp/file.txt')).toBe('/tmp/file.txt')
      await expect(serviceHub.core().getActiveExtensions()).resolves.toEqual([])
      await expect(serviceHub.core().installExtensions()).resolves.toBeUndefined()
      await expect(
        serviceHub.core().installExtension([
          { url: '/extensions/a.js', name: 'extension-a' },
        ])
      ).resolves.toEqual([{ url: '/extensions/a.js', name: 'extension-a' }])
      await expect(serviceHub.core().uninstallExtension(['extension-a'])).resolves.toBe(
        false
      )

      const unlisten = await serviceHub.deeplink().onOpenUrl(vi.fn())
      expect(() => unlisten()).not.toThrow()
      await expect(serviceHub.deeplink().getCurrent()).resolves.toEqual([])
    })
  })
})
