import { it, expect } from 'vitest'
import * as engines from './index'

it('re-exports all engine modules from the barrel', () => {
  expect(engines).toHaveProperty('AIEngine')
  expect(engines).toHaveProperty('OAIEngine')
  expect(engines).toHaveProperty('LocalOAIEngine')
  expect(engines).toHaveProperty('RemoteOAIEngine')
  expect(engines).toHaveProperty('EngineManager')
})
