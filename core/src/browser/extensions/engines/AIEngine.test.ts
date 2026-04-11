import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AIEngine } from './AIEngine'
import { EngineManager } from './EngineManager'
import { chatCompletionRequest, ImportOptions, SessionInfo, UnloadResult, modelInfo } from './AIEngine'

vi.mock('../../events')
vi.mock('../../fs')

const mockEngineManager = {
  register: vi.fn(),
  get: vi.fn(),
}

vi.mock('./EngineManager', () => ({
  EngineManager: {
    instance: vi.fn(() => mockEngineManager),
  },
}))

class TestAIEngine extends AIEngine {
  onUnload(): void {}
  provider = 'test-provider'

  async get(): Promise<modelInfo | undefined> {
    return undefined
  }

  async list(): Promise<modelInfo[]> {
    return []
  }

  async load(modelId: string): Promise<SessionInfo> {
    return {
      pid: 1,
      port: 8080,
      model_id: modelId,
      model_path: '',
      is_embedding: false,
      api_key: '',
    }
  }

  async unload(_sessionId: string): Promise<UnloadResult> {
    return { success: true }
  }

  async chat(_opts: chatCompletionRequest) {
    return { id: 'test', object: 'chat.completion', created: Date.now(), model: 'test', choices: [] }
  }

  async delete(_modelId: string): Promise<void> {
    return
  }

  async import(_modelId: string, _opts: ImportOptions): Promise<void> {
    return
  }

  async abortImport(_modelId: string): Promise<void> {
    return
  }

  async getLoadedModels(): Promise<string[]> {
    return []
  }
}

describe('AIEngine', () => {
  let engine: TestAIEngine

  beforeEach(() => {
    engine = new TestAIEngine('', '')
    vi.clearAllMocks()
    mockEngineManager.register.mockReset()
    mockEngineManager.get.mockReset()
  })

  it('should load model successfully', async () => {
    const modelId = 'model1'

    const result = await engine.load(modelId)

    expect(result).toEqual({ pid: 1, port: 8080, model_id: modelId, model_path: '', is_embedding: false, api_key: '' })
  })

  it('should unload model successfully', async () => {
    const sessionId = 'session1'

    const result = await engine.unload(sessionId)

    expect(result).toEqual({ success: true })
  })

  it('should list models', async () => {
    const result = await engine.list()

    expect(result).toEqual([])
  })

  it('should get loaded models', async () => {
    const result = await engine.getLoadedModels()

    expect(result).toEqual([])
  })

  it('should warn when overwriting an existing engine registration', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockEngineManager.get.mockReturnValue({ provider: engine.provider })

    engine.registerEngine()

    expect(EngineManager.instance).toHaveBeenCalled()
    expect(mockEngineManager.get).toHaveBeenCalledWith(engine.provider)
    expect(mockEngineManager.register).toHaveBeenCalledWith(engine)
    expect(warnSpy).toHaveBeenCalledWith('Overwriting registered engine for provider "test-provider"')

    warnSpy.mockRestore()
  })
})
