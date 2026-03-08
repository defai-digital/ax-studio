/**
 * Ax-Studio Backend Service Configuration Store
 *
 * Persists the four backend service URLs in localStorage so the app
 * can connect to the user's self-hosted Ax-Studio backend services.
 *
 * Defaults assume all services run on localhost with sequential ports:
 *   API Service       → http://127.0.0.1:8000
 *   Retrieval Service → http://127.0.0.1:8001
 *   Agents Service    → http://127.0.0.1:8002
 *   AkiDB             → http://127.0.0.1:8003
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { invoke } from '@tauri-apps/api/core'

export interface AxStudioServiceConfig {
  /** FastAPI inference proxy — OpenAI-compatible /v1/chat/completions */
  apiServiceUrl: string
  /** FastAPI retrieval service — document ingest + semantic search */
  retrievalServiceUrl: string
  /** FastAPI agents service — agent orchestration */
  agentsServiceUrl: string
  /** AkiDB — vector database REST API */
  akidbUrl: string
}

interface AxStudioConfigState {
  config: AxStudioServiceConfig
  setConfig: (updates: Partial<AxStudioServiceConfig>) => Promise<void>
  getRetrievalUrl: () => string
  getAgentsUrl: () => string
  getAkidbUrl: () => string
  getApiServiceUrl: () => string
  /** Sync current config to the Rust backend so the proxy server can route correctly */
  syncToBackend: () => Promise<void>
}

// Migrate localStorage from old ax-fabric key on first load
if (typeof window !== 'undefined') {
  const oldKey = 'ax-fabric-service-config'
  const newKey = 'ax-studio-service-config'
  if (!localStorage.getItem(newKey)) {
    const oldState = localStorage.getItem(oldKey)
    if (oldState) {
      localStorage.setItem(newKey, oldState)
      localStorage.removeItem(oldKey)
    }
  }
}

const DEFAULTS: AxStudioServiceConfig = {
  apiServiceUrl: 'http://127.0.0.1:8000',
  retrievalServiceUrl: 'http://127.0.0.1:8001',
  agentsServiceUrl: 'http://127.0.0.1:8002',
  akidbUrl: 'http://127.0.0.1:8003',
}

export const useAxStudioConfig = create<AxStudioConfigState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULTS },

      setConfig: async (updates) => {
        set((s) => ({ config: { ...s.config, ...updates } }))
        await get().syncToBackend()
      },

      getRetrievalUrl: () =>
        get().config.retrievalServiceUrl || DEFAULTS.retrievalServiceUrl,

      getAgentsUrl: () =>
        get().config.agentsServiceUrl || DEFAULTS.agentsServiceUrl,

      getAkidbUrl: () => get().config.akidbUrl || DEFAULTS.akidbUrl,

      getApiServiceUrl: () =>
        get().config.apiServiceUrl || DEFAULTS.apiServiceUrl,

      syncToBackend: async () => {
        try {
          const { config } = get()
          await invoke('update_ax_studio_service_config', {
            config: {
              api_service_url: config.apiServiceUrl,
              retrieval_service_url: config.retrievalServiceUrl,
              agents_service_url: config.agentsServiceUrl,
              akidb_url: config.akidbUrl,
            },
          })
        } catch (e) {
          // Not fatal — the app may be running in web/non-Tauri mode
          console.warn('Could not sync Ax-Studio service config to backend:', e)
        }
      },
    }),
    {
      name: 'ax-studio-service-config',
    }
  )
)
