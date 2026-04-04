import { describe, it, expect, vi } from 'vitest'
import { bootstrapThreads } from './bootstrap-threads'

const makeServiceHub = (threads: unknown[] = [], shouldFail = false) => ({
  threads: () => ({
    fetchThreads: shouldFail
      ? vi.fn().mockRejectedValue(new Error('fetch failed'))
      : vi.fn().mockResolvedValue(threads),
  }),
})

describe('bootstrapThreads', () => {
  it('calls setThreads with fetched threads', async () => {
    const mockThreads = [{ id: 't1' }, { id: 't2' }]
    const setThreads = vi.fn()
    const result = await bootstrapThreads({
      serviceHub: makeServiceHub(mockThreads) as any,
      setThreads,
    })
    expect(result).toEqual({ ok: true })
    expect(setThreads).toHaveBeenCalledWith(mockThreads)
  })

  it('returns ok: false when fetchThreads rejects', async () => {
    const setThreads = vi.fn()
    const result = await bootstrapThreads({
      serviceHub: makeServiceHub([], true) as any,
      setThreads,
    })
    expect(result.ok).toBe(false)
    expect(setThreads).not.toHaveBeenCalled()
  })

  it('calls setThreads with empty array when no threads exist', async () => {
    const setThreads = vi.fn()
    await bootstrapThreads({
      serviceHub: makeServiceHub([]) as any,
      setThreads,
    })
    expect(setThreads).toHaveBeenCalledWith([])
  })
})
