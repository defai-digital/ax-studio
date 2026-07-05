import { useState, useEffect, useCallback, useRef } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'

type UseProviderModelsState = {
  models: string[]
  loading: boolean
  error: string | null
  refetch: () => void
}

const modelsCache = new Map<string, { models: string[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

function hashCachePart(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

function getProviderModelsCacheKey(provider: ModelProvider): string {
  const baseUrl = provider.base_url?.trim().replace(/\/+$/, '') ?? ''
  const apiKeyHash = hashCachePart(provider.api_key ?? '')
  const customHeaders = (provider.custom_header ?? [])
    .map(
      (header) =>
        `${header.header.trim().toLowerCase()}:${hashCachePart(header.value)}`
    )
    .sort()
    .join('|')

  return [provider.provider, baseUrl, apiKeyHash, customHeaders].join('::')
}

export const useProviderModels = (
  provider?: ModelProvider
): UseProviderModelsState => {
  const serviceHub = useServiceHub()
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prevProviderKey = useRef<string>('')
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchModels = useCallback(async () => {
    if (!provider || !provider.base_url) {
      // Clear models if provider is invalid (base_url is required, api_key is optional)
      requestIdRef.current += 1
      abortRef.current?.abort()
      prevProviderKey.current = ''
      setModels([])
      setError(null)
      setLoading(false)
      return
    }

    // Clear any previous state when starting a new fetch for a different provider
    const currentProviderKey = getProviderModelsCacheKey(provider)
    if (currentProviderKey !== prevProviderKey.current) {
      setModels([])
      setError(null)
      setLoading(false)
      prevProviderKey.current = currentProviderKey
    }

    const cacheKey = currentProviderKey
    const cached = modelsCache.get(cacheKey)

    // Check cache first
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      setModels(cached.models)
      return
    }

    const currentRequestId = ++requestIdRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)

    try {
      const fetchedModels = await serviceHub
        .providers()
        .fetchModelsFromProvider(provider)
      if (
        currentRequestId !== requestIdRef.current ||
        controller.signal.aborted
      )
        return
      const sortedModels = [...fetchedModels].sort((a, b) => a.localeCompare(b))

      setModels(sortedModels)

      modelsCache.set(cacheKey, {
        models: sortedModels,
        timestamp: Date.now(),
      })
    } catch (err) {
      if (
        currentRequestId !== requestIdRef.current ||
        controller.signal.aborted
      )
        return
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch models'
      setError(errorMessage)
      console.error(`Error fetching models from ${provider.provider}:`, err)
    } finally {
      if (
        currentRequestId === requestIdRef.current &&
        !controller.signal.aborted
      )
        setLoading(false)
    }
  }, [provider, serviceHub])

  const refetch = useCallback(() => {
    if (provider) {
      const cacheKey = getProviderModelsCacheKey(provider)
      modelsCache.delete(cacheKey)
      fetchModels()
    }
  }, [provider, fetchModels])

  useEffect(() => {
    fetchModels()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchModels])

  return {
    models,
    loading,
    error,
    refetch,
  }
}
