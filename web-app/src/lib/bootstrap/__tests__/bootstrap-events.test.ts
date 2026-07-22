import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServiceHub } from '@/services'

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

import { bootstrapEvents } from '../bootstrap-events'
import { AppEvent, events } from '@ax-studio/core'

type MockCoreEvents = typeof events & {
  _emit: (event: string, ...args: unknown[]) => void
  _listeners: Record<string, ((...args: unknown[]) => void)[]>
}

const mockEvents = events as MockCoreEvents

const makeProvider = (provider: string): ModelProvider => ({
  active: true,
  provider,
  settings: [],
  models: [],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const makeServiceHub = (providers: ModelProvider[] = []): ServiceHub =>
  ({
    providers: () => ({
      getProviders: vi.fn().mockResolvedValue(providers),
    }),
    path: () => ({ sep: () => '/' }),
  }) as Pick<ServiceHub, 'providers' | 'path'> as ServiceHub

beforeEach(() => {
  vi.mocked(events.on).mockClear()
  vi.mocked(events.off).mockClear()
  mockEvents._listeners['onModelImported'] = []
})

describe('bootstrapEvents', () => {
  it('registers the onModelImported listener', () => {
    const serviceHub = makeServiceHub()
    bootstrapEvents({ serviceHub, setProviders: vi.fn() })
    expect(events.on).toHaveBeenCalledWith(
      AppEvent.onModelImported,
      expect.any(Function)
    )
  })

  it('returns a cleanup that removes the listener', () => {
    const serviceHub = makeServiceHub()
    const cleanup = bootstrapEvents({
      serviceHub,
      setProviders: vi.fn(),
    })
    cleanup()
    expect(events.off).toHaveBeenCalledWith(
      AppEvent.onModelImported,
      expect.any(Function)
    )
  })

  it('calls setProviders with reloaded providers when onModelImported fires', async () => {
    const mockProviders = [makeProvider('openai')]
    const serviceHub = makeServiceHub(mockProviders)
    const setProviders = vi.fn()

    bootstrapEvents({ serviceHub, setProviders })

    // Simulate the event firing
    mockEvents._emit(AppEvent.onModelImported)

    // Wait for the async getProviders call
    await vi.waitFor(() =>
      expect(setProviders).toHaveBeenCalledWith(mockProviders, '/')
    )
  })

  it('does not call setProviders after cleanup', async () => {
    const pending = deferred<ModelProvider[]>()
    const getProviders = vi.fn().mockReturnValue(pending.promise)
    const serviceHub = {
      providers: () => ({ getProviders }),
      path: () => ({ sep: () => '/' }),
    } as Pick<ServiceHub, 'providers' | 'path'> as ServiceHub
    const setProviders = vi.fn()

    const cleanup = bootstrapEvents({
      serviceHub,
      setProviders,
    })
    mockEvents._emit(AppEvent.onModelImported)
    cleanup()
    pending.resolve([makeProvider('openai')])
    await pending.promise
    await Promise.resolve()
    expect(setProviders).not.toHaveBeenCalled()
  })

  it('ignores an older provider refresh that resolves after a newer one', async () => {
    const first = deferred<ModelProvider[]>()
    const second = deferred<ModelProvider[]>()
    const getProviders = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const serviceHub = {
      providers: () => ({ getProviders }),
      path: () => ({ sep: () => '/' }),
    } as Pick<ServiceHub, 'providers' | 'path'> as ServiceHub
    const setProviders = vi.fn()

    bootstrapEvents({ serviceHub, setProviders })
    mockEvents._emit(AppEvent.onModelImported)
    mockEvents._emit(AppEvent.onModelImported)
    second.resolve([makeProvider('anthropic')])
    await second.promise
    await vi.waitFor(() => expect(setProviders).toHaveBeenCalledOnce())
    first.resolve([makeProvider('openai')])
    await first.promise
    await Promise.resolve()

    expect(setProviders).toHaveBeenCalledOnce()
    expect(setProviders).toHaveBeenCalledWith(
      [makeProvider('anthropic')],
      '/'
    )
  })
})
