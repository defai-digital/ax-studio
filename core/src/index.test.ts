import { expect, it } from 'vitest'

it('exposes browser and type exports without mutating the global core object', async () => {
  delete globalThis.core

  const mod = await import('./index')

  expect(mod).toHaveProperty('events')
  expect(mod).toHaveProperty('BaseExtension')
  expect(mod).toHaveProperty('NativeRoute')
  expect(typeof globalThis.core).toBe('undefined')
})
