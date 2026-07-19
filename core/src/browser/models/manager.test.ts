import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModelManager } from './manager'
import { Model, ModelEvent } from '../../types'
import { events } from '../events'

vi.mock('../events', () => ({
  events: {
    emit: vi.fn(),
  },
}))

Object.defineProperty(global, 'window', {
  value: {
    core: {},
  },
  writable: true,
  configurable: true,
})

function removeWindowForTest(): () => void {
  const originalWindow = globalThis.window
  Reflect.deleteProperty(globalThis, 'window')
  return () => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    })
  }
}

describe('ModelManager', () => {
  let modelManager: ModelManager
  let mockModel: Model

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(events.emit).mockReset()
    window.core = {}
    modelManager = new ModelManager()
    mockModel = {
      id: 'test-model-1',
      name: 'Test Model',
      version: '1.0.0',
    } as Model
  })

  describe('constructor', () => {
    it('should set itself on window.core.modelManager when window exists', () => {
      expect(window.core?.modelManager).toBe(modelManager)
    })

    it('should not throw when window is unavailable', () => {
      const restoreWindow = removeWindowForTest()

      expect(() => new ModelManager()).not.toThrow()

      restoreWindow()
    })
  })

  describe('register', () => {
    it('should register a new model', async () => {
      modelManager.register(mockModel)
      await Promise.resolve()

      expect(modelManager.has('test-model-1')).toBe(true)
      expect(modelManager.get('test-model-1')).toEqual(mockModel)
      expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelsUpdate, {})
    })

    it('should merge existing model with new model data and prefer the new values', async () => {
      const existingModel: Model = {
        id: 'test-model-1',
        name: 'Existing Model',
        description: 'Existing description',
      } as Model

      const updatedModel: Model = {
        id: 'test-model-1',
        name: 'Updated Model',
        version: '2.0.0',
      } as Model

      modelManager.register(existingModel)
      modelManager.register(updatedModel)
      await Promise.resolve()

      const registeredModel = modelManager.get('test-model-1')
      expect(registeredModel).toEqual({
        id: 'test-model-1',
        name: 'Updated Model',
        description: 'Existing description',
        version: '2.0.0',
      })
      expect(events.emit).toHaveBeenCalledTimes(1)
    })

    it('should batch model update events emitted in the same tick', async () => {
      const model1: Model = { id: 'model-1', name: 'Model 1' } as Model
      const model2: Model = { id: 'model-2', name: 'Model 2' } as Model

      modelManager.register(model1)
      modelManager.register(model2)

      expect(events.emit).not.toHaveBeenCalled()

      await Promise.resolve()

      expect(events.emit).toHaveBeenCalledTimes(1)
      expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelsUpdate, {})
    })

    it('should not crash when events.emit throws in microtask', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(events.emit).mockImplementation(() => {
        throw new Error('bridge unavailable')
      })

      modelManager.register(mockModel)

      await Promise.resolve()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ModelManager] Failed to emit OnModelsUpdate:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('get', () => {
    it('should retrieve a registered model by id', () => {
      modelManager.register(mockModel)

      const retrievedModel = modelManager.get('test-model-1')
      expect(retrievedModel).toEqual(mockModel)
    })

    it('should return undefined for non-existent model', () => {
      const retrievedModel = modelManager.get('non-existent-model')
      expect(retrievedModel).toBeUndefined()
    })

    it('should return correctly typed model', () => {
      modelManager.register(mockModel)

      const retrievedModel = modelManager.get<Model>('test-model-1')
      expect(retrievedModel?.id).toBe('test-model-1')
      expect(retrievedModel?.name).toBe('Test Model')
    })
  })

  describe('instance', () => {
    it('should create a new instance when none exists on window.core', () => {
      window.core = {}

      const instance = ModelManager.instance()
      expect(instance).toBeInstanceOf(ModelManager)
      expect(window.core.modelManager).toBe(instance)
    })

    it('should return existing instance when it exists on window.core', () => {
      const existingManager = new ModelManager()
      window.core = { ...(window.core ?? {}), modelManager: existingManager }

      const instance = ModelManager.instance()
      expect(instance).toBe(existingManager)
    })

    it('should reuse a cached instance when window is unavailable', () => {
      const restoreWindow = removeWindowForTest()

      const first = ModelManager.instance()
      const second = ModelManager.instance()

      expect(first).toBe(second)

      restoreWindow()
    })
  })

  describe('registry accessors', () => {
    it('should initialize empty', () => {
      expect(modelManager.size).toBe(0)
      expect(modelManager.getAll()).toEqual([])
    })

    it('should maintain multiple models without exposing a mutable Map', () => {
      const model1: Model = { id: 'model-1', name: 'Model 1' } as Model
      const model2: Model = { id: 'model-2', name: 'Model 2' } as Model

      modelManager.register(model1)
      modelManager.register(model2)

      expect(modelManager.size).toBe(2)
      expect(modelManager.get('model-1')).toEqual(model1)
      expect(modelManager.get('model-2')).toEqual(model2)
      expect(modelManager.getAll()).toEqual([model1, model2])
      // Public surface must not expose a mutable Map
      expect(
        Object.prototype.hasOwnProperty.call(modelManager, 'models') ||
          'models' in modelManager
      ).toBe(false)
    })
  })
})
