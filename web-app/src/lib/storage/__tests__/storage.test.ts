import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  safeStorageGetItem,
  safeStorageSetItem,
  safeStorageRemoveItem,
  safeStorageParseJSON,
  safeStorageParseJSONAs,
  safeStorageSetJSON,
  isStorageFlagEnabled,
  createSafeJSONStorage,
  createSafeJSONStorageWithTransforms,
} from '../storage'

function makeStorage(overrides: Partial<Storage> = {}): Storage {
  const store: Record<string, string> = {}
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value },
    removeItem: (key) => { delete store[key] },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length },
    ...overrides,
  } as Storage
}

describe('safeStorageGetItem', () => {
  it('returns the stored value', () => {
    const s = makeStorage()
    s.setItem('k', 'v')
    expect(safeStorageGetItem(s, 'k')).toBe('v')
  })

  it('returns null for missing keys', () => {
    expect(safeStorageGetItem(makeStorage(), 'missing')).toBeNull()
  })

  it('returns null and warns when getItem throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeStorage({ getItem: () => { throw new Error('quota') } })
    expect(safeStorageGetItem(s, 'k', 'ctx')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to read'), expect.any(Error))
    warn.mockRestore()
  })
})

describe('isStorageFlagEnabled', () => {
  it('returns true when value is the string "true"', () => {
    const s = makeStorage()
    s.setItem('flag', 'true')
    expect(isStorageFlagEnabled(s, 'flag')).toBe(true)
  })

  it('returns false when value is absent', () => {
    expect(isStorageFlagEnabled(makeStorage(), 'flag')).toBe(false)
  })

  it('returns false when value is "false"', () => {
    const s = makeStorage()
    s.setItem('flag', 'false')
    expect(isStorageFlagEnabled(s, 'flag')).toBe(false)
  })

  it('returns false when value is "1" (not strictly "true")', () => {
    const s = makeStorage()
    s.setItem('flag', '1')
    expect(isStorageFlagEnabled(s, 'flag')).toBe(false)
  })
})

describe('safeStorageSetItem', () => {
  it('stores the value and returns true', () => {
    const s = makeStorage()
    expect(safeStorageSetItem(s, 'k', 'v')).toBe(true)
    expect(s.getItem('k')).toBe('v')
  })

  it('returns false and warns when setItem throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeStorage({ setItem: () => { throw new Error('full') } })
    expect(safeStorageSetItem(s, 'k', 'v')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('safeStorageRemoveItem', () => {
  it('removes the key and returns true', () => {
    const s = makeStorage()
    s.setItem('k', 'v')
    expect(safeStorageRemoveItem(s, 'k')).toBe(true)
    expect(s.getItem('k')).toBeNull()
  })

  it('returns false and warns when removeItem throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeStorage({ removeItem: () => { throw new Error('locked') } })
    expect(safeStorageRemoveItem(s, 'k')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('safeStorageParseJSON', () => {
  it('parses stored JSON and returns typed value', () => {
    const s = makeStorage()
    s.setItem('obj', JSON.stringify({ x: 1 }))
    expect(safeStorageParseJSON<{ x: number }>(s, 'obj')).toEqual({ x: 1 })
  })

  it('returns null for missing key', () => {
    expect(safeStorageParseJSON(makeStorage(), 'missing')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeStorage()
    s.setItem('bad', '{not json}')
    expect(safeStorageParseJSON(s, 'bad')).toBeNull()
    warn.mockRestore()
  })
})

describe('safeStorageParseJSONAs', () => {
  const isString = (v: unknown): v is string => typeof v === 'string'

  it('returns value when guard passes', () => {
    const s = makeStorage()
    s.setItem('k', JSON.stringify('hello'))
    expect(safeStorageParseJSONAs(s, 'k', isString)).toBe('hello')
  })

  it('returns null when guard fails', () => {
    const s = makeStorage()
    s.setItem('k', JSON.stringify(42))
    expect(safeStorageParseJSONAs(s, 'k', isString)).toBeNull()
  })

  it('returns null when key is missing', () => {
    expect(safeStorageParseJSONAs(makeStorage(), 'k', isString)).toBeNull()
  })
})

describe('safeStorageSetJSON', () => {
  it('serialises the value and stores it', () => {
    const s = makeStorage()
    expect(safeStorageSetJSON(s, 'k', { a: 1 })).toBe(true)
    expect(JSON.parse(s.getItem('k')!)).toEqual({ a: 1 })
  })

  it('returns false when the underlying write fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = makeStorage({ setItem: () => { throw new Error('full') } })
    expect(safeStorageSetJSON(s, 'k', {})).toBe(false)
    warn.mockRestore()
  })
})

describe('createSafeJSONStorage', () => {
  it('round-trips a value through getItem / setItem / removeItem', () => {
    const s = makeStorage()
    const storage = createSafeJSONStorage(() => s)

    storage.setItem('key', { state: { count: 3 }, version: 0 })
    expect(storage.getItem('key')).toEqual({ state: { count: 3 }, version: 0 })

    storage.removeItem('key')
    expect(storage.getItem('key')).toBeNull()
  })

  it('returns null when storage resolver throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = createSafeJSONStorage(() => { throw new Error('unavailable') })
    expect(storage.getItem('k')).toBeNull()
    warn.mockRestore()
  })
})

describe('createSafeJSONStorageWithTransforms', () => {
  it('applies deserialize transform on getItem', () => {
    const s = makeStorage()
    s.setItem('k', JSON.stringify({ state: { v: 1 }, version: 0 }))

    const storage = createSafeJSONStorageWithTransforms(
      () => s,
      undefined,
      { deserialize: (v) => ({ ...(v as object), patched: true }) as never }
    )

    expect((storage.getItem('k') as { patched?: boolean })?.patched).toBe(true)
  })

  it('applies serialize transform on setItem', () => {
    const s = makeStorage()
    const storage = createSafeJSONStorageWithTransforms(
      () => s,
      undefined,
      { serialize: (v) => ({ ...v, extra: 'yes' }) as never }
    )

    storage.setItem('k', { state: { x: 1 }, version: 0 })
    const stored = JSON.parse(s.getItem('k')!)
    expect(stored.extra).toBe('yes')
  })
})
