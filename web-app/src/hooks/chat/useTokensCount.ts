import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { ThreadMessage } from '@ax-studio/core'
import { usePrompt } from '@/hooks/ui/usePrompt'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceStore } from '@/hooks/useServiceHub'
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
  }>
) => {
  const serviceHub = useServiceStore((state) => state.serviceHub)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const providers = useModelProvider((state) => state.providers)
  const [tokenData, setTokenData] = useState<TokenCountData>({
    tokenCount: 0,
    loading: false,
    isNearLimit: false,
  })

  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const latestCalculationRef = useRef<(() => Promise<void>) | null>(null)
  const requestIdRef = useRef(0)
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

  const getMaxTokens = useCallback((): number | undefined => {
    const raw =
      selectedModel?.settings?.ctx_len?.controller_props?.value ??
      selectedModel?.settings?.ctx_size?.controller_props?.value
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }

    // For hosted models without explicit settings, provide defaults based on model ID
    // First check if this looks like a hosted model by examining the model ID patterns
    // (even if providers aren't loaded yet)
    const looksLikeHostedModel = selectedModel?.id && (
      selectedModel.id.includes('gpt') ||
      selectedModel.id.includes('claude') ||
      selectedModel.id.includes('mistral') ||
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
      // Common context lengths for popular models - more comprehensive patterns
      const modelPatterns: Array<{ pattern: RegExp, tokens: number }> = [
        // OpenAI models
        { pattern: /gpt-4o/i, tokens: 128000 },
        { pattern: /gpt-4-turbo/i, tokens: 128000 },
        { pattern: /gpt-4/i, tokens: 8192 }, // This should match gpt-4, gpt-4-32k, etc.
        { pattern: /gpt-3\.5-turbo/i, tokens: 16385 },

        // Anthropic models
        { pattern: /claude-3/i, tokens: 200000 }, // Covers all Claude 3 variants

        // Other providers
        { pattern: /mistral/i, tokens: 32000 },
        { pattern: /groq/i, tokens: 128000 },
        { pattern: /gemini/i, tokens: 32768 },
        { pattern: /deepseek/i, tokens: 32768 },
        { pattern: /qwen/i, tokens: 32768 },
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

    return undefined
  }, [selectedModel, providers])

  const runTokenCalculation = useCallback(async () => {
    // Skip if still within backoff window (consecutive failures)
    if (Date.now() < backoffUntilRef.current) return

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
        // For hosted models, use local token estimation
        const messageText = messages
          .map(msg => {
            let text = ''
            if (msg.content) {
              for (const item of msg.content) {
                text += item.text?.value || ''
                // Note: We don't count image tokens in this simple estimation
                // Could be enhanced later if needed
              }
            }
            return text
          })
          .join(' ')

        tokenCount = estimateTokensFromText(messageText)
      } else {
        // For local models, use the backend service
        tokenCount = await serviceHub
          .models()
          .getTokensCount(selectedModel.id, messages)
      }

      if (requestId !== requestIdRef.current) return

      // Success — reset error backoff
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
      if (requestId !== requestIdRef.current) return

      const msg = error instanceof Error ? error.message : String(error)

      // For hosted models, 404 is expected - don't back off since we use local estimation
      if (!isHosted) {
        // 404 means the endpoint doesn't exist on this backend (e.g. ax-serving).
        // Back off for 1 hour immediately — retrying will never succeed.
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
        error:
          error instanceof Error ? error.message : 'Failed to calculate tokens',
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
    }
  }, [prompt, messageSignature, selectedModel?.id])

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
