import { useEffect, useRef, useState } from 'react'
import { buildHarness, type ArtifactType } from '@/lib/artifact-harness'
import { AlertCircleIcon } from 'lucide-react'

interface ArtifactPreviewProps {
  type: ArtifactType
  source: string
  /** Extra key to force remount (e.g. when re-pinning same artifact) */
  version?: number
}

export function ArtifactPreview({ type, source, version }: ArtifactPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState<string | null>(null)

  // baseUrl lets the iframe load vendor scripts from the app's own origin
  // (avoids CSP issues with external CDN inside sandboxed srcdoc frames)
  const baseUrl = window.location.origin + '/'

  // Build srcdoc whenever type/source/version changes
  const srcdoc = buildHarness(type, source, baseUrl)

  // Listen for error messages from the iframe via postMessage
  useEffect(() => {
    setError(null)

    const handler = (event: MessageEvent) => {
      // Only accept messages from our own window (srcdoc iframes post to parent)
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'artifact-error') {
        setError(event.data.message || 'Unknown error in artifact')
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [type, source, version])

  return (
    <div className="relative w-full h-full min-h-[300px] flex flex-col">
      <iframe
        ref={iframeRef}
        key={`${type}-${version ?? 0}`}
        srcDoc={srcdoc}
        sandbox="allow-scripts allow-modals allow-forms allow-downloads"
        className="w-full flex-1 border-0 bg-white"
        title="Artifact Preview"
        // Prevent the iframe from navigating the top-level frame
        referrerPolicy="no-referrer"
      />
      {error && (
        <div className="absolute bottom-0 left-0 right-0 flex items-start gap-2 px-3 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-xs">
          <AlertCircleIcon size={13} className="mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
    </div>
  )
}
