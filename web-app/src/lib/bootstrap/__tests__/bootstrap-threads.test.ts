import { afterEach, describe, it, expect, vi } from 'vitest'
import type { ServiceHub } from '@/services'
import { bootstrapThreads } from '../bootstrap-threads'

afterEach(() => {
  vi.restoreAllMocks()
})

const makeThread = (id: string): Thread => ({
  id,
  title: id,
  updated: 0,
})

const makeServiceHub = (
  threads: Thread[] = [],
  shouldFail = false
): ServiceHub =>
  ({
    threads: () => ({
      fetchThreads: shouldFail
        ? vi.fn().mockRejectedValue(new Error('fetch failed'))
        : vi.fn().mockResolvedValue(threads),
    }),
  }) as Pick<ServiceHub, 'threads'> as ServiceHub

describe('bootstrapThreads', () => {
  it('calls setThreads with fetched threads', async () => {
    const mockThreads = [makeThread('t1'), makeThread('t2')]
    const setThreads = vi.fn()
    const result = await bootstrapThreads({
      serviceHub: makeServiceHub(mockThreads),
      setThreads,
    })
    expect(result).toEqual({ ok: true })
    expect(setThreads).toHaveBeenCalledWith(mockThreads)
  })

  it('returns ok: false when fetchThreads rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const setThreads = vi.fn()
    const result = await bootstrapThreads({
      serviceHub: makeServiceHub([], true),
      setThreads,
    })
    expect(result.ok).toBe(false)
    expect(setThreads).not.toHaveBeenCalled()
  })

  it('calls setThreads with empty array when no threads exist', async () => {
    const setThreads = vi.fn()
    await bootstrapThreads({
      serviceHub: makeServiceHub([]),
      setThreads,
    })
    expect(setThreads).toHaveBeenCalledWith([])
  })
})
