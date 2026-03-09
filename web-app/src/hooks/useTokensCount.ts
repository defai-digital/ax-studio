import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { ThreadMessage } from '@ax-studio/core'
import { usePrompt } from './usePrompt'
import { useModelProvider } from './useModelProvider'
import { useServiceStore } from './useServiceHub'

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const [tokenData, setTokenData] = useState<TokenCountData>({
    tokenCount: 0,
    loading: false,
    isNearLimit: false,
  })

  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const latestCalculationRef = useRef<(() => Promise<void>) | null>(null)
  const requestIdRef = useRef(0)
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
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }, [selectedModel])

  const runTokenCalculation = useCallback(async () => {
    const requestId = ++requestIdRef.current
    const maxTokens = getMaxTokens()

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
      const tokenCount = await serviceHub
        .models()
        .getTokensCount(selectedModel.id, messages)

      if (requestId !== requestIdRef.current) return

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
      setTokenData({
        tokenCount: 0,
        maxTokens,
        percentage: maxTokens ? 0 : undefined,
        loading: false,
        isNearLimit: false,
        error: error instanceof Error ? error.message : 'Failed to calculate tokens',
      })
    }
  }, [getMaxTokens, messages, selectedModel?.id, serviceHub])

  useEffect(() => {
    latestCalculationRef.current = runTokenCalculation
  }, [runTokenCalculation])

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
    }

    debounceTimeoutRef.current = setTimeout(() => {
      void latestCalculationRef.current?.()
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
