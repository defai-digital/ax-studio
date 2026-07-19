import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  Extension,
  ExtensionManager,
  resolveLocalExtensionPath,
} from '../extension'

// Mock dependencies
vi.mock('@ax-studio/core', () => ({
  AIEngine: class MockAIEngine {},
  BaseExtension: class MockBaseExtension {},
  ExtensionTypeEnum: {
    SystemMonitor: 'system-monitor',
    Model: 'model',
    Assistant: 'assistant',
  },
  CoreRoutes: [],
  APIRoutes: [],
  AppRoutes: [],
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path) => `asset://${path}`),
  invoke: vi.fn(),
}))

// Mock window.core.extensionManager
Object.defineProperty(window, 'core', {
  writable: true,
  value: {
    extensionManager: null,
  },
})

describe('extension.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the singleton for each test
    window.core.extensionManager = null
  })

  describe('Extension class', () => {
    it('should create extension with required parameters', () => {
      const extension = new Extension(
        'https://example.com/extension.js',
        'test-extension'
      )

      expect(extension.name).toBe('test-extension')
      expect(extension.url).toBe('https://example.com/extension.js')
      expect(extension.productName).toBeUndefined()
      expect(extension.active).toBeUndefined()
      expect(extension.description).toBeUndefined()
      expect(extension.version).toBeUndefined()
    })

    it('should create extension with all parameters', () => {
      const extension = new Extension(
        'https://example.com/extension.js',
        'test-extension',
        'Test Extension',
        true,
        'A test extension',
        '1.0.0'
      )

      expect(extension.name).toBe('test-extension')
      expect(extension.url).toBe('https://example.com/extension.js')
      expect(extension.productName).toBe('Test Extension')
      expect(extension.active).toBe(true)
      expect(extension.description).toBe('A test extension')
      expect(extension.version).toBe('1.0.0')
    })

    it('should handle optional parameters as undefined', () => {
      const extension = new Extension(
        'https://example.com/extension.js',
        'test-extension',
        undefined,
        undefined,
        undefined,
        undefined
      )

      expect(extension.productName).toBeUndefined()
      expect(extension.active).toBeUndefined()
      expect(extension.description).toBeUndefined()
      expect(extension.version).toBeUndefined()
    })
  })

  describe('ExtensionManager', () => {
    let manager: ExtensionManager

    beforeEach(() => {
      // Reset the singleton for each test
      window.core.extensionManager = null
      manager = ExtensionManager.getInstance()
    })

    it('should be defined', () => {
      expect(ExtensionManager).toBeDefined()
    })

    it('should have required methods', () => {
      expect(typeof manager.get).toBe('function')
      expect(typeof manager.getAll).toBe('function')
      expect(typeof manager.load).toBe('function')
      expect(typeof manager.unload).toBe('function')
    })

    it('should initialize extension manager', async () => {
      await expect(manager.load()).resolves.not.toThrow()
    })

    it('should get all extensions', () => {
      const extensions = manager.getAll()
      expect(Array.isArray(extensions)).toBe(true)
    })

    it('should get extension by name', () => {
      const extension = manager.getByName('non-existent')
      expect(extension).toBeUndefined()
    })

    it('should handle unloading extensions', () => {
      expect(() => manager.unload()).not.toThrow()
    })
  })

  describe('Extension loading', () => {
    it('resolves relative entries inside the managed extension directory', () => {
      expect(
        resolveLocalExtensionPath(
          'conversational/index.js',
          '/app-data/extensions'
        )
      ).toBe('/app-data/extensions/conversational/index.js')
    })

    it.each([
      'https://example.com/extension.js',
      'data:text/javascript,alert(1)',
      '../outside.js',
      '/tmp/outside.js',
      '//example.com/extension.js',
    ])('rejects unmanaged extension entry %s', (entry) => {
      expect(() =>
        resolveLocalExtensionPath(entry, '/app-data/extensions')
      ).toThrow()
    })

    it.each(['nested/\u0000evil.js', 'nested/\u001fevil.js', 'nested/\u0085evil.js'])(
      'rejects control characters in extension entry %s',
      (entry) => {
        expect(() =>
          resolveLocalExtensionPath(entry, '/app-data/extensions')
        ).toThrow('Invalid extension entry path')
      }
    )

    it('allows an absolute entry under the managed directory', () => {
      expect(
        resolveLocalExtensionPath(
          '/app-data/extensions/download/index.js',
          '/app-data/extensions'
        )
      ).toBe('/app-data/extensions/download/index.js')
    })

    it('should convert file source correctly', async () => {
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      convertFileSrc('/path/to/extension.js')

      expect(convertFileSrc).toHaveBeenCalledWith('/path/to/extension.js')
    })

    it('should invoke tauri commands', async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      vi.mocked(invoke).mockResolvedValue('success')

      await invoke('test_command', { param: 'value' })

      expect(invoke).toHaveBeenCalledWith('test_command', { param: 'value' })
    })
  })
})
