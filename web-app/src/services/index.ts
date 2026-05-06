/**
 * Service Hub - Centralized service initialization and access
 *
 * This hub initializes all platform services once at app startup,
 * then provides synchronous access to service instances throughout the app.
 */

import { isPlatformTauri } from '@/lib/platform/utils'

import { DefaultMessagesService } from './messages/default'
import { DefaultAssistantsService } from './assistants/default'
import { DefaultProjectsService } from './projects/default'
import { DefaultModelsService } from './models/default'
import { DefaultRAGService } from './rag/default'
import type { RAGService } from './rag/types'
import { DefaultUploadsService } from './uploads/default'
import type { UploadsService } from './uploads/types'
import { DefaultThreadsService } from './threads/default'

import type { ThemeService } from './theme/types'
import type { WindowService } from './window/types'
import type { EventsService } from './events/types'
import type { HardwareService } from './hardware/types'
import type { AppService } from './app/types'
import type { MessagesService } from './messages/types'
import type { MCPService } from './mcp/types'
import type { ThreadsService } from './threads/types'
import type { ProvidersService } from './providers/types'
import type { ModelsService } from './models/types'
import type { AssistantsService } from './assistants/types'
import type { DialogService } from './dialog/types'
import type { OpenerService } from './opener/types'
import type { UpdaterService } from './updater/types'
import type { PathService } from './path/types'
import type { CoreService } from './core/types'
import type { DeepLinkService } from './deeplink/types'
import type { ProjectsService } from './projects/types'

export interface ServiceHub {
  theme(): ThemeService
  window(): WindowService
  events(): EventsService
  hardware(): HardwareService
  app(): AppService
  messages(): MessagesService
  mcp(): MCPService
  threads(): ThreadsService
  providers(): ProvidersService
  models(): ModelsService
  assistants(): AssistantsService
  dialog(): DialogService
  opener(): OpenerService
  updater(): UpdaterService
  path(): PathService
  core(): CoreService
  deeplink(): DeepLinkService
  projects(): ProjectsService
  rag(): RAGService
  uploads(): UploadsService
}

class PlatformServiceHub implements ServiceHub {
  private themeService!: ThemeService
  private windowService!: WindowService
  private eventsService!: EventsService
  private hardwareService!: HardwareService
  private appService!: AppService
  private messagesService: MessagesService = new DefaultMessagesService()
  private mcpService!: MCPService
  private threadsService: ThreadsService = new DefaultThreadsService()
  private providersService!: ProvidersService
  private modelsService: ModelsService = new DefaultModelsService()
  private assistantsService: AssistantsService = new DefaultAssistantsService()
  private dialogService!: DialogService
  private openerService!: OpenerService
  private updaterService!: UpdaterService
  private pathService!: PathService
  private coreService!: CoreService
  private deepLinkService!: DeepLinkService
  private projectsService: ProjectsService = new DefaultProjectsService()
  private ragService: RAGService = new DefaultRAGService()
  private uploadsService: UploadsService = new DefaultUploadsService()
  private initialized = false

  private initializeWebFallbacks(): void {
    const eventTarget = new EventTarget()
    const unsupported = (service: string) =>
      new Error(`${service} is not available in web mode`)

    this.themeService = {
      setTheme: async (theme) => {
        if (typeof document !== 'undefined') {
          document.documentElement.style.colorScheme = theme ?? ''
        }
      },
      getCurrentWindow: () => ({
        setTheme: (theme) => this.themeService.setTheme(theme),
      }),
    }

    this.windowService = {
      createWebviewWindow: async () => {
        throw unsupported('Window service')
      },
      getWebviewWindowByLabel: async () => null,
      openWindow: async ({ url }) => {
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      },
      openLogsWindow: async () => {},
      openSystemMonitorWindow: async () => {},
      openLocalApiServerLogsWindow: async () => {},
    }

    this.eventsService = {
      emit: async (event, payload) => {
        eventTarget.dispatchEvent(new CustomEvent(event, { detail: payload }))
      },
      listen: async (event, handler) => {
        const listener = (e: Event) => {
          handler({ payload: (e as CustomEvent).detail })
        }
        eventTarget.addEventListener(event, listener)
        return () => eventTarget.removeEventListener(event, listener)
      },
    }

    this.hardwareService = {
      getHardwareInfo: async () => null,
      getSystemUsage: async () => null,
      getLlamacppDevices: async () => [],
    }

    this.appService = {
      factoryReset: async () => {
        window.localStorage.clear()
      },
      readLogs: async () => [],
      parseLogLine: (line) => ({
        timestamp: Date.now(),
        level: 'info',
        target: 'web',
        message: line ?? '',
      }),
      getAppDataFolder: async () => undefined,
      relocateAppDataFolder: async () => {
        throw unsupported('App data relocation')
      },
      getServerStatus: async () => false,
      readYaml: async () => {
        throw unsupported('YAML file access')
      },
    }

    const unavailableToolResult = {
      content: [],
      isError: true,
    } as Awaited<ReturnType<MCPService['callTool']>>

    this.mcpService = {
      updateMCPConfig: async () => {},
      restartMCPServers: async () => {},
      getMCPConfig: async () => ({}),
      getTools: async () => [],
      getConnectedServers: async () => [],
      callTool: async () => unavailableToolResult,
      callToolWithCancellation: ({ cancellationToken }) => ({
        promise: Promise.resolve(unavailableToolResult),
        cancel: async () => {},
        token: cancellationToken ?? crypto.randomUUID(),
      }),
      cancelToolCall: async () => {},
      activateMCPServer: async () => {},
      deactivateMCPServer: async () => {},
    }

    this.providersService = {
      getProviders: async () => [],
      fetchModelsFromProvider: async () => [],
      updateSettings: async () => {},
      fetch: () => fetch,
    }

    this.dialogService = {
      open: async () => null,
      save: async () => null,
    }

    this.openerService = {
      revealItemInDir: async () => {},
    }

    this.updaterService = {
      check: async () => null,
      installAndRestart: async () => {},
      downloadAndInstallWithProgress: async () => {},
    }

    this.pathService = {
      sep: () => '/',
      join: async (...segments) => segments.filter(Boolean).join('/').replace(/\/+/g, '/'),
      dirname: async (path) => {
        const normalized = path.replace(/\/+$/, '')
        const index = normalized.lastIndexOf('/')
        return index > 0 ? normalized.slice(0, index) : '/'
      },
      basename: async (path) => path.split('/').filter(Boolean).pop() ?? '',
      extname: async (path) => {
        const name = path.split('/').pop() ?? ''
        const index = name.lastIndexOf('.')
        return index > 0 ? name.slice(index) : ''
      },
    }

    this.coreService = {
      invoke: async (command) => {
        throw unsupported(`Core command "${command}"`)
      },
      convertFileSrc: (filePath) => filePath,
      getActiveExtensions: async () => [],
      installExtensions: async () => {},
      installExtension: async (extensions) => extensions,
      uninstallExtension: async () => false,
    }

    this.deepLinkService = {
      onOpenUrl: async () => () => {},
      getCurrent: async () => [],
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      if (isPlatformTauri()) {
        const [
          themeModule,
          windowModule,
          eventsModule,
          hardwareModule,
          appModule,
          mcpModule,
          providersModule,
          dialogModule,
          openerModule,
          updaterModule,
          pathModule,
          coreModule,
          deepLinkModule,
        ] = await Promise.all([
          import('./theme/tauri'),
          import('./window/tauri'),
          import('./events/tauri'),
          import('./hardware/tauri'),
          import('./app/tauri'),
          import('./mcp/tauri'),
          import('./providers/tauri'),
          import('./dialog/tauri'),
          import('./opener/tauri'),
          import('./updater/tauri'),
          import('./path/tauri'),
          import('./core/tauri'),
          import('./deeplink/tauri'),
        ])

        this.themeService = new themeModule.TauriThemeService()
        this.windowService = new windowModule.TauriWindowService()
        this.eventsService = new eventsModule.TauriEventsService()
        this.hardwareService = new hardwareModule.TauriHardwareService()
        this.appService = new appModule.TauriAppService()
        this.mcpService = new mcpModule.TauriMCPService()
        this.providersService = new providersModule.TauriProvidersService()
        this.dialogService = new dialogModule.TauriDialogService()
        this.openerService = new openerModule.TauriOpenerService()
        this.updaterService = new updaterModule.TauriUpdaterService()
        this.pathService = new pathModule.TauriPathService()
        this.coreService = new coreModule.TauriCoreService()
        this.deepLinkService = new deepLinkModule.TauriDeepLinkService()
      } else {
        this.initializeWebFallbacks()
      }

      if ('setMcpService' in this.ragService) {
        const svc = this.ragService as { setMcpService: (mcp: MCPService) => void }
        svc.setMcpService(this.mcpService)
      }
      if ('setMcpService' in this.uploadsService) {
        const svc = this.uploadsService as { setMcpService: (mcp: MCPService) => void }
        svc.setMcpService(this.mcpService)
      }

      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize service hub:', error)
      throw error
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Service hub not initialized. Call initializeServiceHub() first.'
      )
    }
  }

  theme(): ThemeService {
    this.ensureInitialized()
    return this.themeService
  }

  window(): WindowService {
    this.ensureInitialized()
    return this.windowService
  }

  events(): EventsService {
    this.ensureInitialized()
    return this.eventsService
  }

  hardware(): HardwareService {
    this.ensureInitialized()
    return this.hardwareService
  }

  app(): AppService {
    this.ensureInitialized()
    return this.appService
  }

  messages(): MessagesService {
    this.ensureInitialized()
    return this.messagesService
  }

  mcp(): MCPService {
    this.ensureInitialized()
    return this.mcpService
  }

  threads(): ThreadsService {
    this.ensureInitialized()
    return this.threadsService
  }

  providers(): ProvidersService {
    this.ensureInitialized()
    return this.providersService
  }

  models(): ModelsService {
    this.ensureInitialized()
    return this.modelsService
  }

  assistants(): AssistantsService {
    this.ensureInitialized()
    return this.assistantsService
  }

  dialog(): DialogService {
    this.ensureInitialized()
    return this.dialogService
  }

  opener(): OpenerService {
    this.ensureInitialized()
    return this.openerService
  }

  updater(): UpdaterService {
    this.ensureInitialized()
    return this.updaterService
  }

  path(): PathService {
    this.ensureInitialized()
    return this.pathService
  }

  core(): CoreService {
    this.ensureInitialized()
    return this.coreService
  }

  deeplink(): DeepLinkService {
    this.ensureInitialized()
    return this.deepLinkService
  }

  projects(): ProjectsService {
    this.ensureInitialized()
    return this.projectsService
  }

  rag(): RAGService {
    this.ensureInitialized()
    return this.ragService
  }

  uploads(): UploadsService {
    this.ensureInitialized()
    return this.uploadsService
  }
}

export async function initializeServiceHub(): Promise<ServiceHub> {
  const serviceHub = new PlatformServiceHub()
  await serviceHub.initialize()
  return serviceHub
}
