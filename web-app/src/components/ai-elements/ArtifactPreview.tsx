import { useEffect, useRef, useState, useCallback } from 'react'
import { buildHarnessAsync, type ArtifactType } from '@/lib/artifact-harness'
import { AlertCircleIcon, RefreshCw, Copy } from 'lucide-react'

const TYPE_LABELS: Record<ArtifactType, string> = {
  html: 'HTML page',
  react: 'React component',
  svg: 'SVG graphic',
  chartjs: 'Chart.js chart',
  vega: 'Vega-Lite chart',
}

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
  const [retryVersion, setRetryVersion] = useState(0)
  const [copied, setCopied] = useState(false)
  const baseUrl = window.location.origin + '/'

  const effectiveVersion = (version ?? 0) + retryVersion

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
  }, [type, source, effectiveVersion]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleRetry = useCallback(() => {
    setError(null)
    setRetryVersion((v) => v + 1)
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API may fail in some contexts — silent fallback
    }
  }, [source])

  return (
    <div className="relative w-full h-full min-h-[300px] flex flex-col bg-white">
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-white z-10 pointer-events-none">
          <span className="animate-pulse">Preparing…</span>
        </div>
      )}

      <iframe
        ref={iframeRef}
        key={`${type}-${effectiveVersion}`}
        className="w-full flex-1 border-0 bg-white"
        style={{ colorScheme: 'light' }}
        title="Artifact Preview"
      />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white z-20">
          <div className="max-w-md mx-auto p-6 text-center">
            <AlertCircleIcon size={24} className="mx-auto mb-3 text-destructive" />
            <p className="text-sm font-medium text-foreground mb-1">Rendering failed</p>
            <p className="text-xs text-muted-foreground mb-4">
              Could not render this {TYPE_LABELS[type]}.
            </p>
            <div className="flex items-center justify-center gap-2 mb-4">
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <RefreshCw size={12} />
                Retry
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <Copy size={12} />
                {copied ? 'Copied' : 'Copy Source'}
              </button>
            </div>
            <details className="text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                Error details
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs font-mono text-destructive overflow-auto max-h-32 break-words whitespace-pre-wrap">
                {error}
              </pre>
            </details>
          </div>
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
