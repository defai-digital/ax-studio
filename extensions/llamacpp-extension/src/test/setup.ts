// Node 22+ ships a global `localStorage` getter that returns undefined unless
// the process is started with --localstorage-file, and it shadows jsdom's
// Storage implementation in the Vitest environment. Install an in-memory
// replacement — exposed as the global `Storage` class so tests can spy on
// `Storage.prototype` — and back both localStorage and sessionStorage with it.
if (globalThis.localStorage == null) {
  const stores = new WeakMap<MemoryStorage, Map<string, string>>()

  class MemoryStorage {
    constructor() {
      stores.set(this, new Map())
    }
    get length(): number {
      return stores.get(this)!.size
    }
    clear(): void {
      stores.get(this)!.clear()
    }
    getItem(key: string): string | null {
      const store = stores.get(this)!
      return store.has(key) ? store.get(key)! : null
    }
    key(index: number): string | null {
      return Array.from(stores.get(this)!.keys())[index] ?? null
    }
    removeItem(key: string): void {
      stores.get(this)!.delete(key)
    }
    setItem(key: string, value: string): void {
      stores.get(this)!.set(key, String(value))
    }
  }

  for (const [name, value] of [
    ['Storage', MemoryStorage],
    ['localStorage', new MemoryStorage()],
    ['sessionStorage', new MemoryStorage()],
  ] as const) {
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    })
  }
}
