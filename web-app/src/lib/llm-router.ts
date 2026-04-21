/**
 * LLM Router — Core Module
 *
 * Autonomously selects the best model for each user message by sending
 * a lightweight classification request to a user-configured router model.
 * The router model evaluates the message against the list of available
 * models and picks the best fit using its inherent LLM knowledge.
 *
 * Fallback: if anything fails, returns the currently selected frontend model.
 */

import { type UIMessage } from '@ai-sdk/react'
import { streamText } from 'ai'
import { ModelFactory } from './model-factory'
import { buildRouterPrompt } from './llm-router-prompt'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useFavoriteModel } from '@/hooks/models/useFavoriteModel'
import { predefinedProviders } from '@/constants/providers'
import { z } from 'zod'

const MAX_MODELS_IN_PROMPT = 30
const MAX_USER_MESSAGE_LENGTH = 1000
const MAX_CONTEXT_LENGTH = 500

/**
 * Build a flat list of available models for the router prompt.
 * Filters out embedding models and the router model itself.
 * Prioritizes favorites, then follows provider order.
 */
export function getAvailableModelsForRouter(
  providers: ModelProvider[],
  routerModelId: string,
): AvailableModelForRouter[] {
  const favoriteIds = new Set(
    useFavoriteModel.getState().favoriteModels.map((m) => m.id),
  )

  const allModels: AvailableModelForRouter[] = []

  for (const provider of providers) {
    if (!provider.active) continue

    // Match DropdownModelProvider filtering: skip providers without API key
    // unless they are custom (non-predefined) providers with models loaded
    const hasApiKey = (provider.api_key?.length ?? 0) > 0
    const isPredefined = predefinedProviders.some(
      (e) => e.provider === provider.provider,
    )
    if (!hasApiKey && (isPredefined || provider.models.length === 0)) continue

    for (const model of provider.models) {
      if (model.embedding) continue
      if (model.id === routerModelId) continue

      allModels.push({
        id: model.id,
        provider: provider.provider,
        displayName: model.displayName ?? model.name ?? model.id,
      })
    }
  }

  // Sort: favorites first, then maintain original order
  allModels.sort((a, b) => {
    const aFav = favoriteIds.has(a.id) ? 0 : 1
    const bFav = favoriteIds.has(b.id) ? 0 : 1
    return aFav - bFav
  })

  return allModels.slice(0, MAX_MODELS_IN_PROMPT)
}

/**
 * Extract the last user message text from a messages array.
 */
function getLastUserMessage(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const textParts = msg.parts?.filter((p) => p.type === 'text') ?? []
    const text = textParts.map((p) => p.text).join('\n')
    if (text.trim()) return text.trim()
  }
  return null
}

/**
 * Build a brief recent context string from the last 1-2 assistant/user exchanges.
 */
function getRecentContext(messages: UIMessage[]): string | undefined {
  if (messages.length < 3) return undefined

  const recent: string[] = []
  // Walk backwards from the second-to-last message (last is the current user msg)
  for (let i = messages.length - 2; i >= 0 && recent.length < 2; i--) {
    const msg = messages[i]
    const textParts = msg.parts?.filter((p) => p.type === 'text') ?? []
    const text = textParts.map((p) => p.text).join('\n').trim()
    if (text) {
      recent.unshift(`${msg.role}: ${text.slice(0, 200)}`)
    }
  }

  if (recent.length === 0) return undefined
  const context = recent.join('\n')
  return context.slice(0, MAX_CONTEXT_LENGTH)
}

/**
 * Parse the router model's JSON response and validate against available models.
 * Returns null if parsing fails or model not found (triggers fallback).
 */
export function parseRouterResponse(
  rawText: string,
  availableModels: AvailableModelForRouter[],
): { modelId: string; providerId: string; reason: string } | null {
  const RouterDecisionSchema = z.object({
    model: z.string().min(1),
    provider: z.string().min(1),
    reason: z.string().optional(),
  })

  try {
    // Strip thinking tags (e.g., Qwen 3 models wrap responses in <think>...</think>)
    let cleaned = rawText.trim()
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    // Strip markdown code fences if present
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }

    const parsed = JSON.parse(cleaned)
    const parseResult = RouterDecisionSchema.safeParse(parsed)
    if (!parseResult.success) {
      return null
    }

    const { model, provider, reason: parsedReason } = parseResult.data
    const reason = parsedReason || 'routed'

    if (!model || !provider) return null
    if (model === 'default' || provider === 'default') return null

    // Exact match
    const exact = availableModels.find(
      (m) => m.id === model && m.provider === provider,
    )
    if (exact) return { modelId: exact.id, providerId: exact.provider, reason }

    // Case-insensitive match on model ID + provider
    const caseInsensitive = availableModels.find(
      (m) =>
        m.id.toLowerCase() === model.toLowerCase() &&
        m.provider.toLowerCase() === provider.toLowerCase(),
    )
    if (caseInsensitive) {
      return {
        modelId: caseInsensitive.id,
        providerId: caseInsensitive.provider,
        reason,
      }
    }

    // Match by model ID only (provider might be slightly different)
    const modelOnly = availableModels.find(
      (m) => m.id.toLowerCase() === model.toLowerCase(),
    )
    if (modelOnly) {
      return {
        modelId: modelOnly.id,
        providerId: modelOnly.provider,
        reason,
      }
    }

    // Fuzzy: substring match, min 6 chars and >75% overlap
    const modelLower = model.toLowerCase()
    if (modelLower.length >= 6) {
      const fuzzy = availableModels.find((m) => {
        const idLower = m.id.toLowerCase()
        const isSubstring =
          idLower.includes(modelLower) || modelLower.includes(idLower)
        if (!isSubstring) return false
        const shorter = Math.min(idLower.length, modelLower.length)
        const longer = Math.max(idLower.length, modelLower.length)
        return shorter / longer > 0.75
      })
      if (fuzzy) {
        return { modelId: fuzzy.id, providerId: fuzzy.provider, reason }
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Create a fallback RouterResult using the currently selected frontend model.
 */
function createFallbackResult(
  fallbackModelId: string,
  fallbackProviderId: string,
  fallbackReason: string,
  latencyMs: number,
): RouterResult {
  return {
    modelId: fallbackModelId,
    providerId: fallbackProviderId,
    reason: 'fallback',
    routed: false,
    fallbackReason,
    latencyMs,
  }
}

/**
 * Route a message to the best model by asking the router model to classify it.
 *
 * This is the main entry point. It:
 * 1. Extracts the last user message
 * 2. Builds a prompt with available models
 * 3. Calls the router model via generateText()
 * 4. Parses and validates the response
 * 5. Returns the chosen model or falls back to the selected model
 */
export async function routeMessage(
  messages: UIMessage[],
  routerModelId: string,
  routerProviderId: string,
  availableModels: AvailableModelForRouter[],
  fallbackModelId: string,
  fallbackProviderId: string,
  timeout: number,
): Promise<RouterResult> {
  const startTime = performance.now()

  // Guard: need at least one available model
  if (availableModels.length === 0) {
    return createFallbackResult(
      fallbackModelId,
      fallbackProviderId,
      'no available models for routing',
      performance.now() - startTime,
    )
  }

  // Extract the user's latest message
  const userMessage = getLastUserMessage(messages)
  if (!userMessage) {
    return createFallbackResult(
      fallbackModelId,
      fallbackProviderId,
      'no user message found',
      performance.now() - startTime,
    )
  }

  const recentContext = getRecentContext(messages)
  const { system, user } = buildRouterPrompt(
    userMessage.slice(0, MAX_USER_MESSAGE_LENGTH),
    availableModels,
    recentContext,
  )

  try {
    // Get the router model's provider object
    const routerProvider = useModelProvider
      .getState()
      .getProviderByName(routerProviderId)
    if (!routerProvider) {
      return createFallbackResult(
        fallbackModelId,
        fallbackProviderId,
        'router provider not found',
        performance.now() - startTime,
      )
    }

    // Create the router model via the existing ModelFactory (routes through proxy)
    const routerModel = await ModelFactory.createModel(
      routerModelId,
      routerProvider,
      {},
    )

    // Set up timeout via AbortController
    const abortController = new AbortController()
    const timeoutId = globalThis.setTimeout(
      () => abortController.abort(),
      timeout,
    )

    try {
      // Use streamText with fullStream to collect BOTH text and reasoning deltas.
      // Thinking-mode models (GLM, Qwen 3, DeepSeek R1) consume reasoning tokens
      // before emitting the actual JSON in `content`. With a low maxTokens they
      // exhaust the budget on thinking alone and `content` stays null.
      // 1024 tokens gives ~700 for thinking + ~100 for the JSON response.
      // For non-thinking models the JSON is ~30-50 tokens and the rest is unused.
      const stream = streamText({
        model: routerModel,
        system,
        messages: [{ role: 'user', content: user }],
        maxOutputTokens: 1024,
        temperature: 0,
        abortSignal: abortController.signal,
      })

      let text = ''
      let reasoning = ''
      for await (const part of stream.fullStream) {
        // AI SDK v5 fullStream parts use `.text` (not `.textDelta`)
        if (part.type === 'text-delta') {
          text += (part as { type: 'text-delta'; text: string }).text ?? ''
        }
        if (part.type === 'reasoning-delta') {
          reasoning +=
            (part as { type: 'reasoning-delta'; text: string }).text ?? ''
        }
      }
      // Prefer text output; fall back to reasoning (thinking-mode models)
      if (!text.trim() && reasoning.trim()) text = reasoning

      const latencyMs = performance.now() - startTime

      const parsed = parseRouterResponse(text, availableModels)
      console.debug('[LLM Router] response:', text, '→ parsed:', parsed)
      if (!parsed) {
        return createFallbackResult(
          fallbackModelId,
          fallbackProviderId,
          'could not parse router response',
          latencyMs,
        )
      }

      return {
        modelId: parsed.modelId,
        providerId: parsed.providerId,
        reason: parsed.reason,
        routed: true,
        latencyMs,
      }
    } finally {
      globalThis.clearTimeout(timeoutId)
    }
  } catch (error: unknown) {
    const latencyMs = performance.now() - startTime
    // Extract message from any error shape: Error, {message}, string, or unknown
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : error !== null && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : 'unknown router error'
    // Abort errors vary by environment: DOMException (browser), plain Error (Tauri fetch).
    // Check both the type and common abort/cancel message patterns.
    const isTimeout =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (/abort|cancel/i.test(message) && latencyMs >= timeout * 0.8)
    console.warn('[LLM Router] generateText error:', error, '| extracted message:', message)

    return createFallbackResult(
      fallbackModelId,
      fallbackProviderId,
      isTimeout ? 'router timed out' : message,
      latencyMs,
    )
  }
}
