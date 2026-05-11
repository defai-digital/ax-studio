import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { ThreadMessage } from '@ax-studio/core'
import { usePrompt } from '@/hooks/ui/usePrompt'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceStore } from '@/hooks/useServiceHub'
import { getModelContextLength } from '@/lib/models'
import { extractErrorMessage } from '@/lib/utils/error'
// Simple token estimation for hosted models when backend token counting is unavailable
// Rough approximation: ~4 characters per token for English text
const estimateTokensFromText = (text: string): number => {
  if (!text || text.length === 0) return 0
  // Basic estimation: 1 token per ~4 characters
  return Math.ceil(text.length / 4)
}

// Check if a model provider is hosted (external API) rather than local
const isHostedModel = (selectedModel: { id?: string } | null, providers: ModelProvider[]): boolean => {
  if (!selectedModel?.id) return false

  // Find the provider for this model
  const provider = providers.find(p =>
    p.models?.some((m: Model) => m.id === selectedModel.id)
  )

  if (!provider) {
    return false
  }

  // Hosted providers typically have external URLs and require API keys
  const hasExternalUrl = provider.base_url &&
    !provider.base_url.includes('localhost') &&
    !provider.base_url.includes('127.0.0.1') &&
    !provider.base_url.includes('0.0.0.0')

  const requiresApiKey = provider.settings?.some((s: ProviderSetting) => s.key === 'api-key')

  return !!(hasExternalUrl && requiresApiKey)
}

export interface TokenCountData {
  tokenCount: number
  maxTokens?: number
  percentage?: number
  isNearLimit: boolean
  loading: boolean
  error?: string
}

export const useTokensCount = (
  messages: ThreadMessage[] = [],

  _uploadedFiles?: Array<{
    name: string
    type: string
    size: number
    base64: string
    dataUrl: string
  }>,
  modelOverride?: Model
) => {
  const serviceHub = useServiceStore((state) => state.serviceHub)
  const selectedModelFromStore = useModelProvider((state) => state.selectedModel)
  const providers = useModelProvider((state) => state.providers)
  const selectedModel = modelOverride ?? selectedModelFromStore
  const [tokenData, setTokenData] = useState<TokenCountData>({
    tokenCount: 0,
    loading: false,
    isNearLimit: false,
  })

  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const latestCalculationRef = useRef<(() => Promise<void>) | null>(null)
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  // Backoff: after consecutive apply-template failures, pause retries for 30s
  const consecutiveErrorsRef = useRef(0)
  const backoffUntilRef = useRef(0)
  const { prompt } = usePrompt()
  // Lightweight fingerprint: avoids JSON.stringify on the full message tree.
  // Uses message count + total content length + last role — changes on every
  // streaming token (content grows) without serialising the entire array.
  const messageSignature = useMemo(() => {
    if (messages.length === 0) return ''
    let totalLen = 0
    for (const m of messages) {
      if (m.content) {
        for (const item of m.content) {
          totalLen += item.text?.value?.length ?? 0
          totalLen += item.image_url?.url?.length ?? 0
        }
      }
    }
    return `${messages.length}:${totalLen}:${messages[messages.length - 1].role}`
  }, [messages])
  const modelSignature = `${selectedModel?.id ?? ''}:${(selectedModel as { provider?: string } | undefined)?.provider ?? ''}:${getModelContextLength(selectedModel ?? undefined) ?? ''}`

  const getMaxTokens = useCallback((): number | undefined => {
    const ctxLength = getModelContextLength(selectedModel ?? undefined)
    if (ctxLength !== undefined) return ctxLength

    // For hosted models without explicit settings, provide defaults based on model ID
    // First check if this looks like a hosted model by examining the model ID patterns
    // (even if providers aren't loaded yet)
    const looksLikeHostedModel = selectedModel?.id && (
      selectedModel.id.includes('gpt') ||
      selectedModel.id.includes('claude') ||
      selectedModel.id.includes('groq') ||
      selectedModel.id.includes('gemini') ||
      selectedModel.id.includes('deepseek') ||
      selectedModel.id.includes('qwen') ||
      // Check provider patterns in the model ID
      selectedModel.id.includes('openai') ||
      selectedModel.id.includes('anthropic') ||
      selectedModel.id.includes('azure') ||
      selectedModel.id.includes('openrouter')
    )

    const isHosted = looksLikeHostedModel || isHostedModel(selectedModel, providers)
    if (isHosted && selectedModel?.id) {
      const modelPatterns: Array<{ pattern: RegExp, tokens: number }> = [
        // OpenAI models
        { pattern: /gpt-4o/i, tokens: 128000 },
        { pattern: /gpt-4-turbo/i, tokens: 128000 },
        { pattern: /gpt-4/i, tokens: 8192 }, // This should match gpt-4, gpt-4-32k, etc.
        { pattern: /gpt-3\.5-turbo/i, tokens: 16385 },

        // Anthropic models
        { pattern: /claude-3/i, tokens: 200000 }, // Covers all Claude 3 variants

        // Other providers
        { pattern: /groq/i, tokens: 128000 },
        { pattern: /gemini/i, tokens: 128000 },
        { pattern: /deepseek/i, tokens: 64000 },
        { pattern: /qwen/i, tokens: 32768 },
        { pattern: /mistral/i, tokens: 32000 },
        { pattern: /llama/i, tokens: 128000 },
        { pattern: /command/i, tokens: 128000 },
        { pattern: /google/i, tokens: 128000 },
      ]

      // Check if model ID matches any known patterns
      for (const { pattern, tokens } of modelPatterns) {
        if (pattern.test(selectedModel.id)) {
          return tokens
        }
      }

      // For any hosted model that doesn't match patterns, use a reasonable default
      // Most modern LLMs have context windows of at least 8K tokens
      return looksLikeHostedModel ? 8192 : 4096
    }

    return 8192
  }, [selectedModel, providers])

  const runTokenCalculation = useCallback(async () => {
    if (Date.now() < backoffUntilRef.current) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const requestId = ++requestIdRef.current
    const maxTokens = getMaxTokens()
    const isHosted = isHostedModel(selectedModel, providers)

    if (!serviceHub || !selectedModel?.id || messages.length === 0) {
      if (requestId === requestIdRef.current) {
        setTokenData({
          tokenCount: 0,
          maxTokens,
          percentage: maxTokens ? 0 : undefined,
          loading: false,
          isNearLimit: false,
        })
      }
      return
    }

    if (requestId === requestIdRef.current) {
      setTokenData((prev) => ({ ...prev, loading: true, error: undefined }))
    }

    try {
      let tokenCount: number

      if (isHosted) {
        const messageText = messages
          .map(msg => {
            let text = ''
            if (msg.content) {
              for (const item of msg.content) {
                text += item.text?.value || ''
              }
            }
            return text
          })
          .join(' ')

        tokenCount = estimateTokensFromText(messageText)
      } else {
        tokenCount = await serviceHub
          .models()
          .getTokensCount(selectedModel.id, messages)
        if (controller.signal.aborted) return
        if (tokenCount === 0 && messages.length > 0) {
          const messageText = messages
            .map(msg => {
              let text = ''
              if (msg.content) {
                for (const item of msg.content) {
                  text += item.text?.value || ''
                }
              }
              return text
            })
            .join(' ')
          tokenCount = estimateTokensFromText(messageText)
        }
      }

      if (requestId !== requestIdRef.current || controller.signal.aborted) return

      consecutiveErrorsRef.current = 0

      const percentage =
        maxTokens && maxTokens > 0 ? (tokenCount / maxTokens) * 100 : undefined

      setTokenData({
        tokenCount,
        maxTokens,
        percentage,
        loading: false,
        isNearLimit: percentage !== undefined ? percentage >= 80 : false,
      })
    } catch (error) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return

      const msg = extractErrorMessage(error, String(error))

      if (!isHosted) {
        if (msg.includes('404')) {
          backoffUntilRef.current = Date.now() + 60 * 60 * 1000
        } else {
          consecutiveErrorsRef.current += 1
          if (consecutiveErrorsRef.current >= 3) {
            backoffUntilRef.current = Date.now() + 30_000
          }
        }
      }

      setTokenData({
        tokenCount: 0,
        maxTokens,
        percentage: maxTokens ? 0 : undefined,
        loading: false,
        isNearLimit: false,
        error: extractErrorMessage(error, 'Failed to calculate tokens'),
      })
    }
  }, [getMaxTokens, messages, selectedModel, providers, serviceHub])

  useEffect(() => {
    latestCalculationRef.current = runTokenCalculation
  }, [runTokenCalculation])

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      latestCalculationRef.current?.()
    }, 250)

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      abortRef.current?.abort()
    }
  }, [prompt, messageSignature, modelSignature])

  // Manual calculation function (for click events)
  const calculateTokens = useCallback(async () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }
    await latestCalculationRef.current?.()
  }, [])

  return {
    ...tokenData,
    calculateTokens,
  }
}
