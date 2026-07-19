import { describe, it, expect, beforeEach, vi } from 'vitest'
import { events } from './events'

describe('events module', () => {
  const handler = vi.fn()

  beforeEach(() => {
    // Reset core between tests so each can control the bridge state
    globalThis.core = undefined
    handler.mockClear()
  })

  describe('bridge not available', () => {
    it('emit no-ops safely when bridge is not available', () => {
      expect(() => events.emit('test-event', { value: 1 })).not.toThrow()
    })

    it('on registers against the fallback bridge when bridge is not available', () => {
      const unsubscribe = events.on('test-event', handler)
      events.emit('test-event', { value: 1 })

      expect(handler).toHaveBeenCalledWith({ value: 1 })
      unsubscribe()
      events.emit('test-event', { value: 2 })
      expect(handler).toHaveBeenCalledOnce()
    })

    it('off unregisters from the fallback bridge when bridge is not available', () => {
      events.on('test-event', handler)
      events.off('test-event', handler)
      events.emit('test-event', { value: 1 })

      expect(handler).not.toHaveBeenCalled()
    })

    it('continues delivering to remaining handlers when one throws', () => {
      const first = vi.fn(() => {
        throw new Error('handler boom')
      })
      const second = vi.fn()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      events.on('test-event', first)
      events.on('test-event', second)
      expect(() => events.emit('test-event', { value: 1 })).not.toThrow()

      expect(first).toHaveBeenCalledOnce()
      expect(second).toHaveBeenCalledWith({ value: 1 })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
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
      const unsubscribe = events.on('my-event', handler)

      expect(globalThis.core.events.on).toHaveBeenCalledWith('my-event', handler)
      unsubscribe()
      expect(globalThis.core.events.off).toHaveBeenCalledWith('my-event', handler)
    })

    it('off calls bridge.off with correct arguments', () => {
      events.off('my-event', handler)

      expect(globalThis.core.events.off).toHaveBeenCalledWith('my-event', handler)
    })
  })
})
