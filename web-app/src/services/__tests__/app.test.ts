import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriAppService } from '../app/tauri'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  engineManager: {
    engines: new Map<string, unknown>(),
  },
}))

// Mock dependencies
vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: mocks.invoke,
}))

// Mock EngineManager
vi.mock('@ax-studio/core', () => ({
  EngineManager: {
    instance: () => mocks.engineManager,
  },
}))

const mockCoreApi = {
  installExtensions: vi.fn(),
  relaunch: vi.fn(),
  getAppConfigurations: vi.fn(),
  changeAppDataFolder: vi.fn(),
}

Object.defineProperty(window, 'core', {
  value: {
    api: mockCoreApi,
  },
  writable: true,
})

describe('TauriAppService', () => {
  let appService: TauriAppService

  beforeEach(() => {
    appService = new TauriAppService()
    vi.clearAllMocks()
    mocks.engineManager.engines.clear()
    mocks.invoke.mockResolvedValue(undefined)
    window.localStorage.clear()
    window.core.api = mockCoreApi
  })

  describe('parseLogLine', () => {
    it('should parse valid log line', () => {
      const logLine = '[2024-01-01][10:00:00Z][target][INFO] Test message'
      const result = appService.parseLogLine(logLine)

      expect(result).toEqual({
        timestamp: Date.parse('2024-01-01T10:00:00Z'),
        level: 'info',
        target: 'target',
        message: 'Test message',
      })
    })

    it('should handle invalid log line format', () => {
      const logLine = 'Invalid log line'
      const result = appService.parseLogLine(logLine)

      expect(result.message).toBe('Invalid log line')
      expect(result.level).toBe('info')
      expect(result.target).toBe('info')
      expect(typeof result.timestamp).toBe('number')
    })
  })

  describe('readLogs', () => {
    it('should read and parse logs', async () => {
      const mockLogs =
        '[2024-01-01][10:00:00Z][target][INFO] Test message\n[2024-01-01][10:01:00Z][target][ERROR] Error message'
      mocks.invoke.mockResolvedValue(mockLogs)

      const result = await appService.readLogs()

      expect(mocks.invoke).toHaveBeenCalledWith('read_logs')
      expect(result).toHaveLength(2)
      expect(result[0].message).toBe('Test message')
      expect(result[1].message).toBe('Error message')
    })

    it('should return no entries for empty or blank logs', async () => {
      mocks.invoke.mockResolvedValue('\n  \n')

      const result = await appService.readLogs()

      expect(result).toEqual([])
    })
  })

  describe('getAppDataFolder', () => {
    it('should get app data folder path', async () => {
      const mockConfig = { data_folder: '/path/to/ax-studio/data' }
      mockCoreApi.getAppConfigurations.mockResolvedValue(mockConfig)

      const result = await appService.getAppDataFolder()

      expect(mockCoreApi.getAppConfigurations).toHaveBeenCalled()
      expect(result).toBe('/path/to/ax-studio/data')
    })
  })

  describe('relocateAppDataFolder', () => {
    it('should relocate app data folder', async () => {
      const newPath = '/new/path/to/ax-studio/data'
      mockCoreApi.changeAppDataFolder.mockResolvedValue(undefined)

      await appService.relocateAppDataFolder(newPath)

      expect(mockCoreApi.changeAppDataFolder).toHaveBeenCalledWith({
        newDataFolder: newPath,
      })
    })
  })

  describe('factoryReset', () => {
    it('should unload loaded models, invoke reset, and clear local storage', async () => {
      const engine = {
        getLoadedModels: vi.fn().mockResolvedValue(['model1', 'model2']),
        unload: vi.fn().mockResolvedValue(undefined),
      }
      mocks.engineManager.engines.set('engine1', engine)
      window.localStorage.setItem('theme', 'dark')

      await appService.factoryReset()

      expect(engine.unload).toHaveBeenCalledWith('model1')
      expect(engine.unload).toHaveBeenCalledWith('model2')
      expect(mocks.invoke).toHaveBeenCalledWith('factory_reset')
      expect(window.localStorage.getItem('theme')).toBeNull()
    })
  })
})
