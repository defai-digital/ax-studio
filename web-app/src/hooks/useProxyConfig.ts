import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AES, enc } from 'crypto-js'
import { localStorageKey } from '@/constants/localStorage'

const ENCRYPTION_KEY = 'ax-studio-secure-proxy-key'

const encryptedStorage = {
  getItem: (name: string) => {
    const item = localStorage.getItem(name)
    if (!item) return null
    const parsed = JSON.parse(item)
    return {
      ...parsed,
      proxyPassword: AES.decrypt(parsed.proxyPassword, ENCRYPTION_KEY).toString(
        enc.Utf8
      ),
    }
  },
  setItem: (name: string, value: any) => {
    const encrypted = {
      ...value,
      proxyPassword: AES.encrypt(
        value.proxyPassword || '',
        ENCRYPTION_KEY
      ).toString(),
    }
    localStorage.setItem(name, JSON.stringify(encrypted))
  },
  removeItem: (name: string) => localStorage.removeItem(name),
}

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
