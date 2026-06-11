import { Copy, CheckCheck } from "lucide-react";
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'

const fallbackCopyText = (text: string): boolean => {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch (error) {
    console.error('Clipboard fallback failed:', error)
    return false
  }
}

export const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  // Hold the timer in a ref so rapid re-copies don't stack timers and so
  // unmount can clear it — otherwise a pending setCopied(false) fires on
  // an unmounted component (React warning + small leak).
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
      }
    }
  }, [])

  const handleCopy = async () => {
    let copiedSuccessfully = false

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        copiedSuccessfully = true
      } else {
        copiedSuccessfully = fallbackCopyText(text)
      }
    } catch (error) {
      console.error('Failed to copy text to clipboard:', error)
      copiedSuccessfully = fallbackCopyText(text)
    }

    if (!copiedSuccessfully) return

    setCopied(true)
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null
      setCopied(false)
    }, 2000)
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <CheckCheck size={16} className="text-primary" />
        </>
      ) : (
        <Copy size={16} />
      )}
    </Button>
  )
}
