import { fail, ok, type BootstrapResult } from './bootstrap-result'

export function runBackgroundTask(
  label: string,
  task: () => Promise<void>
): Promise<void> {
  return task().catch((error) => {
    logBootstrapFailure(label, error)
    return undefined
  })
}

export async function runBootstrapTask(
  label: string,
  task: () => Promise<void>,
): Promise<BootstrapResult> {
  try {
    await task()
    return ok()
  } catch (error) {
    logBootstrapFailure(label, error)
    return fail(error)
  }
}

function logBootstrapFailure(label: string, error: unknown) {
  console.error(`[bootstrap] ${label} failed:`, error)
}

export function generatePrefixedApiKey(prefix = 'ax-', byteLength = 24): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  const randomHex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}${randomHex}`
}

export async function refreshProviders(
  getProvider: () => { getProviders: () => Promise<ModelProvider[]> },
  getPathSeparator: () => string,
  setProviders: (providers: ModelProvider[], pathSep: string) => void
): Promise<void> {
  const providers = await getProvider().getProviders()
  setProviders(providers, getPathSeparator())
}
