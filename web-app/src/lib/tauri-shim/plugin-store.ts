// Electron shim for @tauri-apps/plugin-store — see docs/architecture/electron-migration-phase0-matrix.md
import { bridgeInvoke } from './bridge'

export interface StoreOptions {
  autoSave?: boolean
  defaults?: Record<string, unknown>
}

export class Store {
  #data: Record<string, unknown> = {}
  #autoSave: boolean

  constructor(
    readonly name: string,
    options: StoreOptions = {}
  ) {
    this.#autoSave = options.autoSave ?? false
    if (options.defaults) this.#data = { ...options.defaults }
  }

  async load(): Promise<void> {
    const stored = await bridgeInvoke<Record<string, unknown>>('plugin_store_load', {
      name: this.name,
    })
    this.#data = { ...this.#data, ...stored }
  }

  async reload(): Promise<void> {
    this.#data = await bridgeInvoke<Record<string, unknown>>('plugin_store_load', {
      name: this.name,
    })
  }

  async save(): Promise<void> {
    await bridgeInvoke('plugin_store_save', { name: this.name, data: this.#data })
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.#data[key] as T | undefined
  }

  async set(key: string, value: unknown): Promise<void> {
    this.#data[key] = value
    if (this.#autoSave) await this.save()
  }

  async has(key: string): Promise<boolean> {
    return key in this.#data
  }

  async delete(key: string): Promise<boolean> {
    const existed = key in this.#data
    delete this.#data[key]
    if (this.#autoSave) await this.save()
    return existed
  }

  async clear(): Promise<void> {
    this.#data = {}
    if (this.#autoSave) await this.save()
  }

  async keys(): Promise<string[]> {
    return Object.keys(this.#data)
  }

  async values<T>(): Promise<T[]> {
    return Object.values(this.#data) as T[]
  }

  async entries<T>(): Promise<Array<[string, T]>> {
    return Object.entries(this.#data) as Array<[string, T]>
  }
}

const storeCache = new Map<string, Store>()

export async function load(name: string, options: StoreOptions = {}): Promise<Store> {
  const cached = storeCache.get(name)
  if (cached) return cached
  const store = new Store(name, options)
  await store.load()
  storeCache.set(name, store)
  return store
}
