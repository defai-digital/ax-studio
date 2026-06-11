import { describe, it, test, expect, beforeEach } from 'vitest'
import { EngineManager } from './EngineManager'
import { AIEngine } from './AIEngine'

class MockAIEngine extends AIEngine {
  readonly provider: string
  constructor(provider: string) {
    super('', provider, provider, true, 'mock engine', '1.0.0')
    this.provider = provider
  }

  onLoad(): void {}

  onUnload(): void {}

  async get(): Promise<undefined> {
    return undefined
  }

  async list(): Promise<[]> {
    return []
  }

  async load(): Promise<any> {
    return {
      pid: 1,
      port: 8080,
      model_id: 'mock-model',
      model_path: '',
      is_embedding: false,
      api_key: '',
    }
  }

  async unload(): Promise<{ success: boolean }> {
    return { success: true }
  }

  async chat(): Promise<any> {
    return {
      id: 'mock-chat',
      object: 'chat.completion',
      created: Date.now(),
      model: 'mock-model',
      choices: [],
    }
  }

  async delete(): Promise<void> {}

  async update(): Promise<void> {}

  async import(): Promise<void> {}

  async abortImport(): Promise<void> {}

  async getLoadedModels(): Promise<string[]> {
    return []
  }
}

describe('EngineManager', () => {
  let engineManager: EngineManager

  beforeEach(() => {
    engineManager = new EngineManager()
  })

  test('should register an engine', () => {
    const engine = new MockAIEngine('testProvider')
    engineManager.register(engine)
    expect(engineManager.engines.get('testProvider')).toBe(engine)
  })

  test('should retrieve a registered engine by provider', () => {
    const engine = new MockAIEngine('testProvider')
    engineManager.register(engine)
    const retrievedEngine = engineManager.get<MockAIEngine>('testProvider')
    expect(retrievedEngine).toBe(engine)
  })

  test('should return undefined for an unregistered provider', () => {
    const retrievedEngine = engineManager.get<MockAIEngine>('nonExistentProvider')
    expect(retrievedEngine).toBeUndefined()
  })

  describe('singleton instance', () => {
    test('should return the window.core.engineManager if available', () => {
      const mockEngineManager = new EngineManager()
      // @ts-ignore
      window.core = { engineManager: mockEngineManager }

      const instance = EngineManager.instance()
      expect(instance).toBe(mockEngineManager)

      // Clean up
      // @ts-ignore
      delete window.core
    })

    test('should create a new instance if window.core.engineManager is not available', () => {
      // @ts-ignore
      delete window.core

      const instance = EngineManager.instance()
      expect(instance).toBeInstanceOf(EngineManager)
    })
  })
})
