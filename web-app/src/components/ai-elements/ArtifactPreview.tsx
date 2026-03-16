import React, { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { buildHarnessAsync, preprocessReactSource, type ArtifactType } from '@/lib/artifact-harness'
import { transformJSX } from '@/lib/artifact-transform'
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
// React — transform + eval in main thread, mount via createRoot (no iframe)
// ---------------------------------------------------------------------------
function ReactPreview({ source, version }: { source: string; version?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<Root | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const baseUrl = window.location.origin + '/'

  useEffect(() => {
    setStatus('loading')
    setErrorMsg(null)

    let cancelled = false
    const processed = preprocessReactSource(source)

    transformJSX(processed, baseUrl)
      .then((code) => {
        if (cancelled || !containerRef.current) return
        try {
          // Build a factory function with all React primitives in scope so
          // user code can call useState/useEffect etc. without importing them.
          // eslint-disable-next-line no-new-func
          const factory = new Function(
            'React',
            'useState', 'useEffect', 'useCallback', 'useMemo',
            'useRef', 'useContext', 'useReducer', 'createContext',
            'forwardRef', 'memo', 'Fragment', 'Children',
            'cloneElement', 'createElement', 'isValidElement',
            `${code}\nreturn typeof App !== 'undefined' ? App : null;`
          )

          const AppComponent = factory(
            React,
            React.useState, React.useEffect, React.useCallback, React.useMemo,
            React.useRef, React.useContext, React.useReducer, React.createContext,
            React.forwardRef, React.memo, React.Fragment, React.Children,
            React.cloneElement, React.createElement, React.isValidElement,
          )

          if (!AppComponent) {
            setErrorMsg('No App component found. Make sure your root component is named "App".')
            setStatus('error')
            return
          }

          rootRef.current?.unmount()
          rootRef.current = createRoot(containerRef.current)
          rootRef.current.render(React.createElement(AppComponent))
          setStatus('ready')
        } catch (e) {
          setErrorMsg(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      })

    return () => {
      cancelled = true
      rootRef.current?.unmount()
      rootRef.current = null
    }
  }, [source, version]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative w-full h-full min-h-[300px]">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background z-10 pointer-events-none">
          <span className="animate-pulse">Preparing…</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      {status === 'error' && errorMsg && (
        <div className="absolute bottom-0 left-0 right-0 flex items-start gap-2 px-3 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-xs">
          <AlertCircleIcon size={13} className="mt-0.5 shrink-0" />
          <span className="break-words">{errorMsg}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HTML / ChartJS / Vega — iframe with inlined vendor scripts
// ---------------------------------------------------------------------------
function IframePreview({ type, source, version }: { type: ArtifactType; source: string; version?: number }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const baseUrl = window.location.origin + '/'

  useEffect(() => {
    setSrcdoc(null)
    setError(null)

    let cancelled = false
    buildHarnessAsync(type, source, baseUrl)
      .then((h) => { if (!cancelled) setSrcdoc(h) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })

    return () => { cancelled = true }
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
  }, [type, source, version])

  return (
    <div className="relative w-full h-full min-h-[300px] flex flex-col">
      {!srcdoc && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground bg-background z-10 pointer-events-none">
          <span className="animate-pulse">Preparing…</span>
        </div>
      )}

      {srcdoc && (
        <iframe
          ref={iframeRef}
          key={`${type}-${version ?? 0}`}
          srcDoc={srcdoc}
          className="w-full flex-1 border-0"
          title="Artifact Preview"
        />
      )}

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
  if (type === 'react') {
    return <ReactPreview source={source} version={version} />
  }
  // html | chartjs | vega → iframe
  return <IframePreview type={type} source={source} version={version} />
}
