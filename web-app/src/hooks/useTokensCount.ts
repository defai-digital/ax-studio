import { useCallback, useState, useRef, useEffect } from 'react'
import { ThreadMessage } from '@ax-studio/core'
import { usePrompt } from './usePrompt'

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
  const [tokenData, setTokenData] = useState<TokenCountData>({
    tokenCount: 0,
    loading: false,
    isNearLimit: false,
  })

  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const latestCalculationRef = useRef<(() => Promise<void>) | null>(null)
  const requestIdRef = useRef(0)
  const { prompt } = usePrompt()

  // Token calculation is a no-op since llamacpp (the only local token counting engine) has been removed.
  // Always returns zero token count.
  const runTokenCalculation = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (requestId === requestIdRef.current) {
      setTokenData({
        tokenCount: 0,
        loading: false,
        isNearLimit: false,
      })
    }
  }, [])

  useEffect(() => {
    latestCalculationRef.current = runTokenCalculation
  }, [runTokenCalculation])

  // Token counting is disabled (llamacpp removed); always reset to zero.
  useEffect(() => {
    requestIdRef.current += 1
    setTokenData({
      tokenCount: 0,
      loading: false,
      isNearLimit: false,
    })
  }, [prompt, messages.length])

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
