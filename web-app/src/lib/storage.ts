import type { PersistStorage, StorageValue } from 'zustand/middleware'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const logStorageError = (
  action: 'read' | 'write' | 'remove' | 'parse' | 'resolve',
  key: string,
  error: unknown,
  context?: string
) => {
  const label = context ? `${context} ` : ''
  console.warn(`[storage] Failed to ${action} ${label}${key}:`, error)
}

const resolveStorage = (
  getStorage: () => StorageLike,
  context?: string
): StorageLike | null => {
  try {
    return getStorage()
  } catch (error) {
    logStorageError('resolve', 'storage', error, context)
    return null
  }
}

export const safeStorageGetItem = (
  storage: StorageLike,
  key: string,
  context?: string
): string | null => {
  try {
    return storage.getItem(key)
  } catch (error) {
    logStorageError('read', key, error, context)
    return null
  }
}

export const safeStorageSetItem = (
  storage: StorageLike,
  key: string,
  value: string,
  context?: string
): boolean => {
  try {
    storage.setItem(key, value)
    return true
  } catch (error) {
    logStorageError('write', key, error, context)
    return false
  }
}

export const safeStorageRemoveItem = (
  storage: StorageLike,
  key: string,
  context?: string
): boolean => {
  try {
    storage.removeItem(key)
    return true
  } catch (error) {
    logStorageError('remove', key, error, context)
    return false
  }
}

export const safeStorageGetJson = <T>(
  storage: StorageLike,
  key: string,
  context?: string
): T | null => {
  const raw = safeStorageGetItem(storage, key, context)
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    logStorageError('parse', key, error, context)
    return null
  }
}

export const createSafeJSONStorage = <T>(
  getStorage: () => StorageLike,
  context?: string
): PersistStorage<T> => ({
  getItem: (name) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return null

    const item = safeStorageGetItem(storage, name, context)
    if (!item) return null

    try {
      return JSON.parse(item) as StorageValue<T>
    } catch (error) {
      logStorageError('parse', name, error, context)
      return null
    }
  },
  setItem: (name, value) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return

    try {
      storage.setItem(name, JSON.stringify(value))
    } catch (error) {
      logStorageError('write', name, error, context)
    }
  },
  removeItem: (name) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return
    safeStorageRemoveItem(storage, name, context)
  },
})
