import { useCallback, useEffect, useRef, useState } from 'react'
import { copyTextToClipboard } from '@/lib/utils/clipboard'

interface UseClipboardCopyOptions {
  resetDelayMs?: number
}

export function useClipboardCopy({
  resetDelayMs = 2000,
}: UseClipboardCopyOptions = {}) {
  const [isCopied, setIsCopied] = useState(false)
  const mountedRef = useRef(true)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
    }
  }, [])

  const copyToClipboard = useCallback(
    async (text: string): Promise<boolean> => {
      const copied = await copyTextToClipboard(text)
      if (!copied || !mountedRef.current) return false

      setIsCopied(true)
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null
        if (mountedRef.current) {
          setIsCopied(false)
        }
      }, resetDelayMs)

      return true
    },
    [resetDelayMs]
  )

  return { isCopied, copyToClipboard }
}
