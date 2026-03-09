/**
 * Shared retrieval service client utilities.
 *
 * Both the RAG service and the Uploads service need to locate the retrieval
 * service URL from localStorage and issue HTTP requests through the Tauri
 * fetch plugin (with a browser-fetch fallback). Centralising these here
 * prevents the two consumers from drifting apart.
 */

import { DEFAULT_SERVICE_URLS } from '@/constants/services'
import { localStorageKey } from '@/constants/localStorage'
import { serviceConfigStorageSchema } from '@/schemas/config.schema'

export const DEFAULT_RETRIEVAL_URL = DEFAULT_SERVICE_URLS.retrieval

/**
 * Read the retrieval service base URL from persisted config, falling back to
 * the default localhost address when nothing is stored or parsing fails.
 */
export function getRetrievalServiceUrl(): string {
  try {
    const stored = localStorage.getItem(localStorageKey.serviceConfig)
    if (stored) {
      const parsed = serviceConfigStorageSchema.safeParse(JSON.parse(stored))
      if (parsed.success) {
        return parsed.data.state?.config?.retrievalServiceUrl ?? DEFAULT_RETRIEVAL_URL
      }
    }
  } catch {
    console.warn('Failed to read retrieval service URL from localStorage')
  }
  return DEFAULT_RETRIEVAL_URL
}

/**
 * Fetch wrapper that prefers the Tauri HTTP plugin (avoids CORS restrictions
 * on desktop) and transparently falls back to the browser's native fetch.
 */
export async function doFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(url, init)
  } catch {
    return fetch(url, init)
  }
}
