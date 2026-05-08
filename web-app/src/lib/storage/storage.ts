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
  return parsed && isValid(parsed) ? parsed : null
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
): PersistStorage<T> =>
  createSafeJSONStorageWithTransforms(getStorage, context)

export const createSafeJSONStorageWithTransforms = <T>(
  getStorage: () => StorageLike,
  context: string | undefined,
  transforms?: {
    deserialize?: (value: StorageValue<T> | unknown) => StorageValue<T> | null
    serialize?: (value: StorageValue<T>) => StorageValue<T>
  }
): PersistStorage<T> => ({
  getItem: (name) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return null

    const parsed = safeStorageParseJSON<unknown>(storage, name, context)
    if (!parsed) return null

    return transforms?.deserialize
      ? transforms.deserialize(parsed)
      : (parsed as StorageValue<T>)
  },
  setItem: (name, value) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return

    const transformed = transforms?.serialize
      ? transforms.serialize(value)
      : value
    safeStorageSetJSON(storage, name, transformed, context)
  },
  removeItem: (name) => {
    const storage = resolveStorage(getStorage, context)
    if (!storage) return
    safeStorageRemoveItem(storage, name, context)
  },
})
