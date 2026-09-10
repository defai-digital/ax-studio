import { getSecureSecret, setSecureSecret } from './secure-secret'

const SECRET = 'model-provider-credentials'
type Credentials = Record<string, string>
const credentials: Credentials = Object.create(null)
let pending: Credentials = Object.create(null)
let ready: Promise<void> | undefined
let writes = Promise.resolve()

function keyOf(provider: ModelProvider): string | undefined {
  if (typeof provider.api_key === 'string') return provider.api_key
  const value = (
    Array.isArray(provider.settings) ? provider.settings : []
  ).find((s) => s?.key === 'api-key')?.controller_props?.value
  return typeof value === 'string' ? value : undefined
}

export function initializeProviderCredentials(): Promise<void> {
  ready ??= getSecureSecret(SECRET)
    .then((stored) => {
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') credentials[key] = value
          }
        }
      }
      Object.assign(credentials, pending)
      pending = Object.create(null)
    })
    .catch((error) => {
      ready = undefined
      throw error
    })
  return ready
}

export function restoreProviderCredentials(
  providers: ModelProvider[]
): ModelProvider[] {
  return providers.map((provider) => {
    const value = credentials[provider.provider]
    if (value === undefined) return provider
    return {
      ...provider,
      api_key: value,
      settings: provider.settings.map((setting) =>
        setting.key === 'api-key'
          ? {
              ...setting,
              controller_props: { ...setting.controller_props, value },
            }
          : setting
      ),
    }
  })
}

/** Capture secrets in memory and strip every known API-key copy before disk I/O. */
export function stripProviderCredentials<
  T extends { state: { providers?: ModelProvider[] } },
>(payload: T, capture = true): T {
  if (!payload || !Array.isArray(payload.state?.providers)) return payload
  const providers = payload.state.providers.map((provider) => {
    if (!provider || typeof provider !== 'object') return provider
    const value = keyOf(provider)
    if (capture && value !== undefined) {
      pending[provider.provider] = value
      credentials[provider.provider] = value
    }
    const { api_key: _key, ...metadata } = provider
    return {
      ...metadata,
      settings: (Array.isArray(provider.settings) ? provider.settings : []).map(
        (setting) => {
          if (!setting || setting.key !== 'api-key') return setting
          const { value: _value, ...props } = setting.controller_props ?? {}
          return { ...setting, controller_props: props }
        }
      ),
    }
  })
  return { ...payload, state: { ...payload.state, providers } }
}

export function persistProviderCredentials(): Promise<void> {
  // Snapshot each edit and serialize writes so slow saves cannot restore an older key.
  const snapshot = { ...pending }
  const save = writes
    .catch(() => undefined)
    .then(async () => {
      await initializeProviderCredentials()
      Object.assign(credentials, snapshot)
      await setSecureSecret(SECRET, JSON.stringify(credentials))
    })
  writes = save
  return save
}

export function clearProviderCredential(provider: string): Promise<void> {
  pending[provider] = ''
  credentials[provider] = ''
  return persistProviderCredentials()
}
