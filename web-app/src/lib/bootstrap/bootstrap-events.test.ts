import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @ax-studio/core events before importing the module under test
vi.mock('@ax-studio/core', () => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
  return {
    AppEvent: { onModelImported: 'onModelImported' },
    events: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        ;(listeners[event] ??= []).push(handler)
      }),
      off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler)
      }),
      _emit: (event: string, ...args: unknown[]) => {
        ;(listeners[event] ?? []).forEach((h) => h(...args))
      },
      _listeners: listeners,
    },
  }
})

import { bootstrapEvents } from './bootstrap-events'
import { AppEvent, events } from '@ax-studio/core'

const makeServiceHub = (providers: ModelProvider[] = []) => ({
  providers: () => ({
    getProviders: vi.fn().mockResolvedValue(providers),
  }),
  path: () => ({ sep: () => '/' }),
})

beforeEach(() => {
  vi.mocked(events.on).mockClear()
  vi.mocked(events.off).mockClear()
  ;(events as any)._listeners['onModelImported'] = []
})

describe('bootstrapEvents', () => {
  it('registers the onModelImported listener', () => {
    const serviceHub = makeServiceHub()
    bootstrapEvents({ serviceHub: serviceHub as any, setProviders: vi.fn() })
    expect(events.on).toHaveBeenCalledWith(AppEvent.onModelImported, expect.any(Function))
  })

  it('returns a cleanup that removes the listener', () => {
    const serviceHub = makeServiceHub()
    const cleanup = bootstrapEvents({ serviceHub: serviceHub as any, setProviders: vi.fn() })
    cleanup()
    expect(events.off).toHaveBeenCalledWith(AppEvent.onModelImported, expect.any(Function))
  })

  it('calls setProviders with reloaded providers when onModelImported fires', async () => {
    const mockProviders = [{ provider: 'openai' }] as ModelProvider[]
    const serviceHub = makeServiceHub(mockProviders)
    const setProviders = vi.fn()

    bootstrapEvents({ serviceHub: serviceHub as any, setProviders })

    // Simulate the event firing
    ;(events as any)._emit(AppEvent.onModelImported)

    // Wait for the async getProviders call
    await vi.waitFor(() => expect(setProviders).toHaveBeenCalledWith(mockProviders, '/'))
  })

  it('does not call setProviders after cleanup', async () => {
    const serviceHub = makeServiceHub([{ provider: 'openai' }] as ModelProvider[])
    const setProviders = vi.fn()

    const cleanup = bootstrapEvents({ serviceHub: serviceHub as any, setProviders })
    cleanup()

    ;(events as any)._emit(AppEvent.onModelImported)
    await new Promise((r) => setTimeout(r, 10))
    expect(setProviders).not.toHaveBeenCalled()
  })
})
