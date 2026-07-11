import { Copy, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useClipboardCopy } from '@/hooks/ui/useClipboardCopy'

export const CopyButton = ({ text }: { text: string }) => {
  const { isCopied, copyToClipboard } = useClipboardCopy()

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={isCopied ? 'Copied' : 'Copy'}
      title={isCopied ? 'Copied' : 'Copy'}
      onClick={() => void copyToClipboard(text)}
    >
      {isCopied ? (
        <>
          <CheckCheck size={16} className="text-primary" />
        </>
      ) : (
        <Copy size={16} />
      )}
    </Button>
  )
}
