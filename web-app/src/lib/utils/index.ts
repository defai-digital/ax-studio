import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Node, Position } from 'unist'
import type { Code, Paragraph, Parent, Text } from 'mdast'
import { visit } from 'unist-util-visit'


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Remark plugin that disables indented code block syntax.
 * Converts indented code blocks (without language specifier) to plain text paragraphs,
 * while preserving fenced code blocks with backticks.
 */
export function disableIndentedCodeBlockPlugin() {
  return (tree: Node) => {
    visit(tree, 'code', (node: Code, index, parent: Parent | undefined) => {
      // Convert indented code blocks (nodes without lang or meta property)
      // to plain text
      // Check if the parent exists so we can replace the node safely
      if (!node.lang && !node.meta && parent && typeof index === 'number') {
        const nodePosition: Position | undefined = node.position
        const textNode: Text = {
          type: 'text',
          value: node.value,
          position: nodePosition
        }
        const paragraphNode: Paragraph = {
          type: 'paragraph',
          children: [textNode],
          position: nodePosition
        }
        parent.children[index] = paragraphNode
      }
    })
  }
}

/**
 * Get the display name for a model, falling back to the model ID if no display name is set
 */
export function getModelDisplayName(model: Model): string {
  return model.displayName || model.id
}

export function getProviderLogo(provider: string) {
  switch (provider) {
    case 'anthropic':
      return '/images/model-provider/anthropic.svg'
    case 'openrouter':
      return '/images/model-provider/open-router.svg'
    case 'groq':
      return '/images/model-provider/groq.svg'
    case 'cohere':
      return '/images/model-provider/cohere.svg'
    case 'gemini':
      return '/images/model-provider/gemini.svg'
    case 'openai':
      return '/images/model-provider/openai.svg'
    case 'azure':
      return '/images/model-provider/azure.svg'
    default:
      return undefined
  }
}

export function getProviderColor(provider: string): string {
  switch (provider) {
    case 'openai':
      return '#10a37f'
    case 'anthropic':
      return '#cc7e3a'
    case 'gemini':
      return '#4285f4'
    case 'groq':
      return '#f97316'
    case 'openrouter':
      return '#6366f1'
    case 'azure':
      return '#0078d4'
    case 'cohere':
      return '#39594d'
    default:
      return '#6b7280'
  }
}

export function getProviderDescription(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'GPT-4o, o1, and more'
    case 'anthropic':
      return 'Claude 3.5, Claude 4'
    case 'gemini':
      return 'Gemini Pro and Ultra'
    case 'groq':
      return 'Ultra-fast inference'
    case 'openrouter':
      return 'Multi-provider API gateway'
    case 'azure':
      return 'Azure OpenAI Service'
    default:
      return 'Custom model provider'
  }
}

export const getProviderTitle = (provider: string) => {
  switch (provider) {
    case 'openai':
      return 'OpenAI'
    case 'openrouter':
      return 'OpenRouter'
    case 'gemini':
      return 'Gemini'
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1)
  }
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
