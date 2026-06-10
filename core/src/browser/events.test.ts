import { describe, it, expect, beforeEach, vi } from 'vitest'
import { events } from './events'

describe('events module', () => {
  const handler = vi.fn()

  beforeEach(() => {
    // Reset core between tests so each can control the bridge state
    // @ts-expect-error - typed as read-only but tests need to overwrite
    globalThis.core = undefined
    handler.mockClear()
  })

  describe('bridge not available', () => {
    it('emit no-ops safely when bridge is not available', () => {
      expect(() => events.emit('test-event', { value: 1 })).not.toThrow()
    })

    it('on registers against the fallback bridge when bridge is not available', () => {
      events.on('test-event', handler)
      events.emit('test-event', { value: 1 })

      expect(handler).toHaveBeenCalledWith({ value: 1 })
    })

    it('off unregisters from the fallback bridge when bridge is not available', () => {
      events.on('test-event', handler)
      events.off('test-event', handler)
      events.emit('test-event', { value: 1 })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('bridge available', () => {
    beforeEach(() => {
      globalThis.core = {
        events: {
          on: vi.fn(),
          off: vi.fn(),
          emit: vi.fn(),
        },
      }
    })

    it('emit calls bridge.emit with correct arguments', () => {
      const payload = { message: 'hello' }
      events.emit('my-event', payload)

      expect(globalThis.core.events.emit).toHaveBeenCalledWith('my-event', payload)
    })

    it('on calls bridge.on with correct arguments', () => {
      events.on('my-event', handler)

      expect(globalThis.core.events.on).toHaveBeenCalledWith('my-event', handler)
    })

    it('off calls bridge.off with correct arguments', () => {
      events.off('my-event', handler)

      expect(globalThis.core.events.off).toHaveBeenCalledWith('my-event', handler)
    })
  })
})
