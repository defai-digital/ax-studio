import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export { disableIndentedCodeBlockPlugin } from '@/lib/markdown/disable-indented-code'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get the display name for a model, falling back to the model ID if no display name is set
 */
export function getModelDisplayName(model: Model): string {
  return model.displayName || model.id
}

const PROVIDER_METADATA: Record<string, { logo?: string; color: string; description: string; title: string }> = {
  openai:     { logo: '/images/model-provider/openai.svg',       color: '#10a37f', description: 'GPT-4o, o1, and more',         title: 'OpenAI' },
  anthropic:  { logo: '/images/model-provider/anthropic.svg',    color: '#cc7e3a', description: 'Claude 3.5, Claude 4',          title: 'Anthropic' },
  gemini:     { logo: '/images/model-provider/gemini.svg',       color: '#4285f4', description: 'Gemini Pro and Ultra',          title: 'Gemini' },
  groq:       { logo: '/images/model-provider/groq.svg',         color: '#f97316', description: 'Ultra-fast inference',          title: 'Groq' },
  openrouter: { logo: '/images/model-provider/open-router.svg',  color: '#6366f1', description: 'Multi-provider API gateway',    title: 'OpenRouter' },
  azure:      { logo: '/images/model-provider/azure.svg',        color: '#0078d4', description: 'Azure OpenAI Service',          title: 'Azure' },
  cohere:     { logo: '/images/model-provider/cohere.svg',       color: '#39594d', description: 'Custom model provider',         title: 'Cohere' },
}

export function getProviderLogo(provider: string): string | undefined {
  return PROVIDER_METADATA[provider]?.logo
}

export function getProviderColor(provider: string): string {
  return PROVIDER_METADATA[provider]?.color ?? '#6b7280'
}

export function getProviderDescription(provider: string): string {
  return PROVIDER_METADATA[provider]?.description ?? 'Custom model provider'
}

export function getProviderTitle(provider: string): string {
  return PROVIDER_METADATA[provider]?.title ?? (provider.charAt(0).toUpperCase() + provider.slice(1))
}

export function formatMegaBytes(mb: number) {
  const tb = mb / (1024 * 1024)
  if (tb >= 1) {
    return `${tb.toFixed(2)} TB`
  } else {
    const gb = mb / 1024
    return `${gb.toFixed(2)} GB`
  }
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function isDev() {
  return window.location.host.startsWith('localhost:')
}

export function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9/_\-.]/g, '').replace(/\./g, '_')
}
