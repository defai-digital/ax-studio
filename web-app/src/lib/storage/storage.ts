import { safeJSONParse } from '@/lib/utils/json'
import type { PersistStorage, StorageValue } from 'zustand/middleware'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const logStorageError = (
  action: 'read' | 'write' | 'remove' | 'resolve',
  key: string,
  error: unknown,
  context?: string
) => {
  const label = context ? `${context} ` : ''
  console.warn(`[storage] Failed to ${action} ${label}${key}:`, error)
}

const isStorageUnavailableError = (error: unknown) =>
  error instanceof ReferenceError &&
  /\b(localStorage|sessionStorage)\b.*\bnot defined\b/i.test(error.message)

const resolveStorage = (
  getStorage: () => StorageLike,
  context?: string
): StorageLike | null => {
  try {
    return getStorage()
  } catch (error) {
    if (!isStorageUnavailableError(error)) {
      logStorageError('resolve', 'storage', error, context)
    }
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

export const isStorageFlagEnabled = (
  storage: StorageLike,
  key: string,
  context?: string
): boolean => {
  return safeStorageGetItem(storage, key, context) === 'true'
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

export const safeStorageParseJSON = <T>(
  storage: StorageLike,
  key: string,
  context?: string
): T | null => {
  const value = safeStorageGetItem(storage, key, context)
  if (!value) return null

  return safeJSONParse<T>(value)
}

export const safeStorageParseJSONAs = <T>(
  storage: StorageLike,
  key: string,
  isValid: (value: unknown) => value is T,
  context?: string
): T | null => {
  const parsed = safeStorageParseJSON<unknown>(storage, key, context)
  // Use nullish check so valid falsy JSON values (0, false, "") pass the guard.
  if (parsed === null || parsed === undefined) return null
  return isValid(parsed) ? parsed : null
}

export const safeStorageSetJSON = (
  storage: StorageLike,
  key: string,
  value: unknown,
  context?: string
): boolean => {
  return safeStorageSetItem(storage, key, JSON.stringify(value), context)
}

export const createSafeJSONStorage = <T>(
  getStorage: () => StorageLike,
  context?: string
): PersistStorage<T> => ({
  getItem: (name) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return null

    const parsed = safeStorageParseJSON<unknown>(storage, name, context)
    if (parsed === null || parsed === undefined) return null

    return parsed as StorageValue<T>
  },
  setItem: (name, value) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return

    safeStorageSetJSON(storage, name, value, context)
  },
  removeItem: (name) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return
    safeStorageRemoveItem(storage, name, context)
  },
})
