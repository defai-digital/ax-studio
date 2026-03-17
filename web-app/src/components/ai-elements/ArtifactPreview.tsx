import { useEffect, useRef, useState } from 'react'
import { buildHarnessAsync, type ArtifactType } from '@/lib/artifact-harness'
import { AlertCircleIcon } from 'lucide-react'

interface ArtifactPreviewProps {
  type: ArtifactType
  source: string
  /** Extra key to force remount (e.g. when re-pinning same artifact) */
  version?: number
}

// ---------------------------------------------------------------------------
// SVG — render inline (same as Mermaid), no iframe needed
// ---------------------------------------------------------------------------
function SvgPreview({ source }: { source: string }) {
  return (
    <div
      className="w-full h-full min-h-[300px] flex items-center justify-center p-4 overflow-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted Claude-generated SVG
      dangerouslySetInnerHTML={{ __html: source }}
    />
  )
}

// ---------------------------------------------------------------------------
// HTML / React / ChartJS / Vega
//
// Both `srcdoc` and `contentDocument.write()` render blank in Tauri's
// WKWebView because WebKit only triggers its compositing paint cycle when the
// iframe navigates to an actual URL. We build a Blob, create a blob: URL, and
// set `iframe.src` — this triggers a proper load + paint cycle.
//
// `frame-src: blob:` is already present in tauri.conf.json so blob iframes
// are allowed by the app CSP.
// ---------------------------------------------------------------------------
function IframePreview({ type, source, version }: { type: ArtifactType; source: string; version?: number }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const baseUrl = window.location.origin + '/'

  useEffect(() => {
    setLoading(true)
    setError(null)

    let cancelled = false
    let objectUrl = ''

    buildHarnessAsync(type, source, baseUrl)
      .then((html) => {
        if (cancelled) return
        const iframe = iframeRef.current
        if (!iframe) return

        // Create a blob: URL so WebKit performs a real navigation + paint
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        objectUrl = URL.createObjectURL(blob)

        // Revoke after load to free memory; also mark loading done
        iframe.addEventListener('load', function onLoad() {
          if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = '' }
          if (!cancelled) setLoading(false)
        }, { once: true })

        iframe.src = objectUrl
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      // Revoke only if onLoad hasn't consumed it yet
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = '' }
    }
  }, [type, source, version]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for runtime errors posted from inside the iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'artifact-error') {
        setError(event.data.message || 'Unknown error in artifact')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return (
    <div className="relative w-full h-full min-h-[300px] flex flex-col bg-white">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-white z-10 pointer-events-none">
          <span className="animate-pulse">Preparing…</span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={`${type}-${version ?? 0}`}
        className="w-full flex-1 border-0 bg-white"
        style={{ colorScheme: 'light' }}
        title="Artifact Preview"
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

// ---------------------------------------------------------------------------
// Public component — dispatches to the right renderer
// ---------------------------------------------------------------------------
export function ArtifactPreview({ type, source, version }: ArtifactPreviewProps) {
  if (type === 'svg') {
    return <SvgPreview source={source} />
  }
  // react | html | chartjs | vega → blob: URL iframe for WKWebView compatibility
  return <IframePreview type={type} source={source} version={version} />
}
