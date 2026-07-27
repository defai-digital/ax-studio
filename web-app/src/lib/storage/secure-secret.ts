import { invoke } from '@/lib/tauri-shim/api-core'
import { isPlatformTauri } from '@/lib/platform/utils'

export const PROXY_PASSWORD_SECRET = 'proxy-password'
/** AX BI MCP bearer token stored through the desktop secure-secret bridge. */
export const AX_BI_MCP_TOKEN_SECRET = 'ax-bi-mcp-token'
/** Hugging Face Hub access token used for private/gated model downloads. */
export const HUGGING_FACE_TOKEN_SECRET = 'hugging-face-token'
/** Bearer token for an externally managed local AX Engine server. */
export const AX_ENGINE_ATTACH_API_KEY_SECRET = 'ax-engine-attach-api-key'

export async function getSecureSecret(key: string): Promise<string | null> {
  if (!isPlatformTauri()) return null

  const value = await invoke<unknown>('get_secret', { key })
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error('Secure credential store returned an invalid value')
  }
  return value
}

export async function setSecureSecret(
  key: string,
  value: string
): Promise<void> {
  if (!isPlatformTauri()) return
  await invoke('set_secret', { key, value })
}

export async function deleteSecureSecret(key: string): Promise<void> {
  if (!isPlatformTauri()) return
  await invoke('delete_secret', { key })
}
