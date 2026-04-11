import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { AES, enc } from 'crypto-js'
import { localStorageKey } from '@/constants/localStorage'
import { encrypt as cryptoEncrypt, decrypt as cryptoDecrypt } from '@/lib/crypto'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage'

// Legacy decrypt — still used to read values written by the previous
// hardcoded-AES implementation, so existing users don't lose their
// proxy password on upgrade. New writes go through `@/lib/crypto` which
// uses Web Crypto AES-GCM with a per-install random key.
const LEGACY_ENCRYPTION_KEY = 'ax-studio-secure-proxy-key'

const tryLegacyDecrypt = (value: string): string | null => {
  try {
    const plain = AES.decrypt(value, LEGACY_ENCRYPTION_KEY).toString(enc.Utf8)
    return plain || null
  } catch {
    return null
  }
}

const encryptedStorage = {
  getItem: async (name: string): Promise<StorageValue<ProxyConfigState> | null> => {
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
    if (typeof rawPassword === 'string' && rawPassword.length > 0) {
      // Try the new Web Crypto path first, then fall back to the legacy
      // hardcoded-AES path so existing installations keep working.
      const viaNewCrypto = await cryptoDecrypt(rawPassword)
      if (viaNewCrypto && viaNewCrypto !== rawPassword) {
        proxyPassword = viaNewCrypto
      } else {
        proxyPassword = tryLegacyDecrypt(rawPassword) ?? viaNewCrypto
      }
    }

    return {
      ...parsed,
      state: {
        ...stateObj,
        proxyPassword,
      },
    }
  },
  setItem: async (
    name: string,
    value: StorageValue<ProxyConfigState>
  ): Promise<void> => {
    const stateObj = value.state
    const plainPassword =
      typeof stateObj.proxyPassword === 'string' ? stateObj.proxyPassword : ''
    const encryptedPassword = plainPassword
      ? await cryptoEncrypt(plainPassword)
      : ''
    const payload = {
      ...value,
      state: {
        ...stateObj,
        proxyPassword: encryptedPassword,
      },
    }
    safeStorageSetItem(
      localStorage,
      name,
      JSON.stringify(payload),
      'useProxyConfig'
    )
  },
  removeItem: (name: string) => {
    safeStorageRemoveItem(localStorage, name, 'useProxyConfig')
  },
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
      setProxyUrl: (proxyUrl) => set({ proxyUrl }),
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
      storage: encryptedStorage,
    }
  )
)
