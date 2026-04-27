import { describe, test, expect, beforeEach, vi } from 'vitest'
import { RemoteOAIEngine } from './'
import { SecretString } from '../../../types'

vi.mock('../../events')

class TestRemoteOAIEngine extends RemoteOAIEngine {
  inferenceUrl: string = ''
  provider: string = 'TestRemoteOAIEngine'
}

describe('RemoteOAIEngine', () => {
  let engine: TestRemoteOAIEngine

  beforeEach(() => {
    engine = new TestRemoteOAIEngine('', '')
    vi.clearAllMocks()
  })

  test('should call onLoad and super.onLoad', () => {
    const onLoadSpy = vi.spyOn(engine, 'onLoad')
    const superOnLoadSpy = vi.spyOn(Object.getPrototypeOf(RemoteOAIEngine.prototype), 'onLoad')
    engine.onLoad()

    expect(onLoadSpy).toHaveBeenCalled()
    expect(superOnLoadSpy).toHaveBeenCalled()
  })

  describe('headers()', () => {
    test('returns Authorization header when apiKey is set', async () => {
      engine.apiKey = SecretString.from('test-key')
      const headers = await engine.headers()

      expect(headers).toEqual({
        'Authorization': 'Bearer test-key',
      })
    })

    test('returns empty object when no apiKey set', async () => {
      engine.apiKey = undefined
      const headers = await engine.headers()

      expect(headers).toEqual({})
    })

    test('returns empty object when apiKey has empty value', async () => {
      engine.apiKey = SecretString.from('')
      const headers = await engine.headers()

      expect(headers).toEqual({})
    })
  })
})
