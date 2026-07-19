import { create } from 'zustand'
import {
  persist,
  type PersistStorage,
  type StorageValue,
} from 'zustand/middleware'
import { AES, enc } from 'crypto-js'
import { localStorageKey } from '@/constants/localStorage'
import {
  deleteSecureSecret,
  getSecureSecret,
  PROXY_PASSWORD_SECRET,
  setSecureSecret,
} from '@/lib/storage/secure-secret'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'

const LEGACY_ENCRYPTION_KEY = 'ax-studio-secure-proxy-key'

let proxyStorageTail: Promise<void> = Promise.resolve()

async function withProxyStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = proxyStorageTail
  let release!: () => void
  proxyStorageTail = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

const tryLegacyDecrypt = (value: string): string | null => {
  try {
    const plain = AES.decrypt(value, LEGACY_ENCRYPTION_KEY).toString(enc.Utf8)
    return plain || null
  } catch {
    return null
  }
}

export const proxyConfigStorage = {
  getItem: (name: string): Promise<StorageValue<ProxyConfigState> | null> =>
    withProxyStorageLock(async () => {
    const item = safeStorageGetItem(localStorage, name, 'useProxyConfig')
    if (!item) return null
    let parsed: StorageValue<ProxyConfigState>
    try {
      parsed = JSON.parse(item) as StorageValue<ProxyConfigState>
    } catch {
      return null
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.state) {
      return null
    }

    const stateObj = parsed.state
    const rawPassword = stateObj.proxyPassword
    let proxyPassword = ''
    try {
      proxyPassword = (await getSecureSecret(PROXY_PASSWORD_SECRET)) ?? ''
    } catch (error) {
      console.error('Unable to read the proxy password securely:', error)
    }

    if (!proxyPassword && typeof rawPassword === 'string' && rawPassword) {
      const legacyPassword = tryLegacyDecrypt(rawPassword)
      if (legacyPassword) {
        proxyPassword = legacyPassword
        try {
          await setSecureSecret(PROXY_PASSWORD_SECRET, legacyPassword)
        } catch (error) {
          console.error('Unable to migrate the proxy password securely:', error)
        }
      }
    }

    // Remove all historical password material from browser storage immediately.
    safeStorageSetItem(
      localStorage,
      name,
      JSON.stringify({
        ...parsed,
        state: { ...stateObj, proxyPassword: '' },
      }),
      'useProxyConfig'
    )

    return {
      ...parsed,
      state: {
        ...stateObj,
        proxyPassword,
      },
    }
    }),
  setItem: (
    name: string,
    value: StorageValue<ProxyConfigState>
  ): Promise<void> =>
    withProxyStorageLock(async () => {
    const stateObj = value.state
    const plainPassword =
      typeof stateObj.proxyPassword === 'string' ? stateObj.proxyPassword : ''
    const payload = {
      ...value,
      state: {
        ...stateObj,
        proxyPassword: '',
      },
    }
    safeStorageSetItem(
      localStorage,
      name,
      JSON.stringify(payload),
      'useProxyConfig'
    )

    if (plainPassword) {
      await setSecureSecret(PROXY_PASSWORD_SECRET, plainPassword)
    } else {
      await deleteSecureSecret(PROXY_PASSWORD_SECRET)
    }
    }),
  removeItem: (name: string) =>
    withProxyStorageLock(async () => {
      safeStorageRemoveItem(localStorage, name, 'useProxyConfig')
      await deleteSecureSecret(PROXY_PASSWORD_SECRET)
    }),
} satisfies PersistStorage<ProxyConfigState>

type ProxyConfigState = {
  proxyEnabled: boolean
  proxyUrl: string
  proxyUsername: string
  proxyPassword: string
  proxyIgnoreSSL: boolean
  verifyProxySSL: boolean
  verifyProxyHostSSL: boolean
  verifyPeerSSL: boolean
  verifyHostSSL: boolean
  noProxy: string
  // Function to set the proxy configuration
  setProxyEnabled: (proxyEnabled: boolean) => void
  setProxyUrl: (proxyUrl: string) => void
  setProxyUsername: (proxyUsername: string) => void
  setProxyPassword: (proxyPassword: string) => void
  setProxyIgnoreSSL: (proxyIgnoreSSL: boolean) => void
  setVerifyProxySSL: (verifyProxySSL: boolean) => void
  setVerifyProxyHostSSL: (verifyProxyHostSSL: boolean) => void
  setVerifyPeerSSL: (verifyPeerSSL: boolean) => void
  setVerifyHostSSL: (verifyHostSSL: boolean) => void
  setNoProxy: (noProxy: string) => void
}

export const useProxyConfig = create<ProxyConfigState>()(
  persist(
    (set) => ({
      proxyEnabled: false,
      proxyUrl: '',
      proxyUsername: '',
      proxyPassword: '',
      proxyIgnoreSSL: false,
      verifyProxySSL: true,
      verifyProxyHostSSL: true,
      verifyPeerSSL: true,
      verifyHostSSL: true,
      noProxy: '',
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyUrl: (proxyUrl) => {
        const trimmed = proxyUrl.trim()
        if (trimmed && !/^https?:\/\/[^/]+(\/.*)?$/i.test(trimmed)) return
        set({ proxyUrl: trimmed })
      },
      setProxyUsername: (proxyUsername) => set({ proxyUsername }),
      setProxyPassword: (proxyPassword) => set({ proxyPassword }),
      setProxyIgnoreSSL: (proxyIgnoreSSL) => set({ proxyIgnoreSSL }),
      setVerifyProxySSL: (verifyProxySSL) => set({ verifyProxySSL }),
      setVerifyProxyHostSSL: (verifyProxyHostSSL) =>
        set({ verifyProxyHostSSL }),
      setVerifyPeerSSL: (verifyPeerSSL) => set({ verifyPeerSSL }),
      setVerifyHostSSL: (verifyHostSSL) => set({ verifyHostSSL }),
      setNoProxy: (noProxy) => set({ noProxy }),
    }),
    {
      name: localStorageKey.settingProxyConfig,
      storage: proxyConfigStorage,
    }
  )
)
