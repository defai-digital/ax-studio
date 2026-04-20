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
    it('emit throws when bridge is not available', () => {
      expect(() => events.emit('test-event', { value: 1 })).toThrow(
        'Core events bridge is not available'
      )
    })

    it('on throws when bridge is not available', () => {
      expect(() => events.on('test-event', handler)).toThrow(
        'Core events bridge is not available'
      )
    })

    it('off throws when bridge is not available', () => {
      expect(() => events.off('test-event', handler)).toThrow(
        'Core events bridge is not available'
      )
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
