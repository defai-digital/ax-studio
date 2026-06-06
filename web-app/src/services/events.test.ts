import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from './events/EventEmitter'

describe('EventEmitter', () => {
  let eventEmitter: EventEmitter

  beforeEach(() => {
    eventEmitter = new EventEmitter()
  })

  describe('constructor', () => {
    it('should create an instance of EventEmitter', () => {
      expect(eventEmitter).toBeInstanceOf(EventEmitter)
    })
  })

  describe('on method', () => {
    it('should register an event handler', () => {
      const handler = vi.fn()
      eventEmitter.on('test-event', handler)

      eventEmitter.emit('test-event', 'test-data')

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith('test-data')
    })

    it('should register multiple handlers for the same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)

      eventEmitter.emit('test-event', 'test-data')

      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
    })

    it('should return an unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = eventEmitter.on('test-event', handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('should unsubscribe via returned function', () => {
      const handler = vi.fn()
      const unsubscribe = eventEmitter.on('test-event', handler)

      eventEmitter.emit('test-event', 'data1')
      expect(handler).toHaveBeenCalledTimes(1)

      unsubscribe()

      eventEmitter.emit('test-event', 'data2')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should allow registering same handler twice and both fire', () => {
      const handler = vi.fn()
      eventEmitter.on('test-event', handler)
      eventEmitter.on('test-event', handler)

      eventEmitter.emit('test-event', 'data')

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('off method', () => {
    it('should remove an event handler', () => {
      const handler = vi.fn()

      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event', 'data1')
      expect(handler).toHaveBeenCalledTimes(1)

      eventEmitter.off('test-event', handler)
      eventEmitter.emit('test-event', 'data2')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should not affect other handlers when removing one', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)

      eventEmitter.off('test-event', handler1)
      eventEmitter.emit('test-event', 'test-data')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledOnce()
    })

    it('should not throw when removing handler for non-existent event', () => {
      const handler = vi.fn()
      expect(() => eventEmitter.off('non-existent', handler)).not.toThrow()
    })

    it('should not throw when removing non-registered handler', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      eventEmitter.on('test-event', handler1)

      expect(() => eventEmitter.off('test-event', handler2)).not.toThrow()

      // handler1 should still work
      eventEmitter.emit('test-event', 'data')
      expect(handler1).toHaveBeenCalledOnce()
    })

    it('should only remove first occurrence when handler registered twice', () => {
      const handler = vi.fn()
      eventEmitter.on('test-event', handler)
      eventEmitter.on('test-event', handler)

      eventEmitter.off('test-event', handler)
      eventEmitter.emit('test-event', 'data')

      // splice removes only first match, so one remains
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('emit method', () => {
    it('should emit events with data', () => {
      const handler = vi.fn()
      const testData = { message: 'test', number: 42 }

      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event', testData)

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(testData)
    })

    it('should emit events without data', () => {
      const handler = vi.fn()

      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event', undefined)

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(undefined)
    })

    it('should handle different event types independently', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      eventEmitter.on('event1', handler1)
      eventEmitter.on('event2', handler2)

      eventEmitter.emit('event1', 'data1')
      eventEmitter.emit('event2', 'data2')

      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
      expect(handler1).toHaveBeenCalledWith('data1')
      expect(handler2).toHaveBeenCalledWith('data2')
    })

    it('should not throw when emitting event with no handlers', () => {
      expect(() => eventEmitter.emit('no-listeners', 'data')).not.toThrow()
    })

    it('should call handlers in registration order', () => {
      const callOrder: number[] = []
      const handler1 = vi.fn(() => callOrder.push(1))
      const handler2 = vi.fn(() => callOrder.push(2))
      const handler3 = vi.fn(() => callOrder.push(3))

      eventEmitter.on('ordered', handler1)
      eventEmitter.on('ordered', handler2)
      eventEmitter.on('ordered', handler3)

      eventEmitter.emit('ordered', null)

      expect(callOrder).toEqual([1, 2, 3])
    })

    it('should pass null args correctly', () => {
      const handler = vi.fn()
      eventEmitter.on('test', handler)

      eventEmitter.emit('test', null)

      expect(handler).toHaveBeenCalledWith(null)
    })
  })

  describe('integration tests', () => {
    it('should support complete event lifecycle', () => {
      const handler = vi.fn()

      eventEmitter.on('lifecycle-event', handler)

      eventEmitter.emit('lifecycle-event', 'lifecycle-data')
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith('lifecycle-data')

      eventEmitter.off('lifecycle-event', handler)

      eventEmitter.emit('lifecycle-event', 'new-data')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should handle complex data types', () => {
      const handler = vi.fn()
      const complexData = {
        array: [1, 2, 3],
        object: { nested: true },
        function: () => 'test',
        symbol: Symbol('test'),
      }

      eventEmitter.on('complex-event', handler)
      eventEmitter.emit('complex-event', complexData)

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(complexData)
    })

    it('should support unsubscribe via returned function in lifecycle', () => {
      const handler = vi.fn()
      const unsub = eventEmitter.on('event', handler)

      eventEmitter.emit('event', 'first')
      expect(handler).toHaveBeenCalledTimes(1)

      unsub()
      eventEmitter.emit('event', 'second')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple subscribe-unsubscribe cycles', () => {
      const handler = vi.fn()

      const unsub1 = eventEmitter.on('cycle', handler)
      eventEmitter.emit('cycle', 'a')
      unsub1()

      const unsub2 = eventEmitter.on('cycle', handler)
      eventEmitter.emit('cycle', 'b')
      unsub2()

      eventEmitter.emit('cycle', 'c')
      expect(handler).toHaveBeenCalledTimes(2)
      expect(handler).toHaveBeenNthCalledWith(1, 'a')
      expect(handler).toHaveBeenNthCalledWith(2, 'b')
    })
  })
})
