import { describe, it, expect, vi } from 'vitest'
import { mergeButtonRefs } from '@/lib/utils/merge-button-refs'

describe('mergeButtonRefs', () => {
  it('returns a function', () => {
    const merged = mergeButtonRefs([])
    expect(typeof merged).toBe('function')
  })

  it('calls function refs with the value', () => {
    const ref1 = vi.fn()
    const ref2 = vi.fn()
    const merged = mergeButtonRefs([ref1, ref2])

    const element = document.createElement('button')
    merged(element)

    expect(ref1).toHaveBeenCalledWith(element)
    expect(ref2).toHaveBeenCalledWith(element)
  })

  it('assigns to mutable ref objects', () => {
    const ref1 = {
      current: null,
    } as React.MutableRefObject<HTMLButtonElement | null>
    const ref2 = {
      current: null,
    } as React.MutableRefObject<HTMLButtonElement | null>
    const merged = mergeButtonRefs([ref1, ref2])

    const element = document.createElement('button')
    merged(element)

    expect(ref1.current).toBe(element)
    expect(ref2.current).toBe(element)
  })

  it('handles a mix of function refs and object refs', () => {
    const fnRef = vi.fn()
    const objRef = {
      current: null,
    } as React.MutableRefObject<HTMLButtonElement | null>
    const merged = mergeButtonRefs([fnRef, objRef])

    const element = document.createElement('button')
    merged(element)

    expect(fnRef).toHaveBeenCalledWith(element)
    expect(objRef.current).toBe(element)
  })

  it('handles null value (unmount)', () => {
    const fnRef = vi.fn()
    const objRef = {
      current: document.createElement('button'),
    } as React.MutableRefObject<HTMLButtonElement | null>
    const merged = mergeButtonRefs([fnRef, objRef])

    merged(null)

    expect(fnRef).toHaveBeenCalledWith(null)
    expect(objRef.current).toBeNull()
  })

  it('skips null refs in the array', () => {
    const fnRef = vi.fn()
    const merged = mergeButtonRefs([
      null as unknown as React.LegacyRef<HTMLButtonElement>,
      fnRef,
    ])

    const element = document.createElement('button')
    // Should not throw
    merged(element)

    expect(fnRef).toHaveBeenCalledWith(element)
  })

  it('handles empty refs array without errors', () => {
    const merged = mergeButtonRefs([])
    const element = document.createElement('button')

    expect(() => merged(element)).not.toThrow()
  })

  it('skips legacy string refs without blocking other refs', () => {
    const fnRef = vi.fn()
    const merged = mergeButtonRefs([
      'legacyRef' as unknown as React.LegacyRef<HTMLButtonElement>,
      fnRef,
    ])

    const element = document.createElement('button')
    expect(() => merged(element)).not.toThrow()
    expect(fnRef).toHaveBeenCalledWith(element)
  })
})
