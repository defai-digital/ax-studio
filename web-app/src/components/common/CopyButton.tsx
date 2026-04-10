import { Button } from '@/components/ui/button'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

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

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
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
          <IconCopyCheck size={16} className="text-primary" />
        </>
      ) : (
        <IconCopy size={16} />
      )}
    </Button>
  )
}
