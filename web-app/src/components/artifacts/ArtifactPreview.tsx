import { useMemo } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { Artifact } from '@/lib/artifacts/extract-artifacts'
import {
  wrapSvgDocument,
  wrapWithCsp,
} from '@/lib/artifacts/artifact-preview'

/**
 * ArtifactPreview — static html/svg rendering inside a fully sandboxed
 * srcdoc iframe.
 *
 * Security model (v1, static preview only — artifact JavaScript never runs):
 * 1. `sandbox=""` — no allow-scripts, no allow-same-origin: opaque origin,
 *    no script execution, no access to the parent DOM or Tauri IPC.
 * 2. A meta CSP is injected as the FIRST <head> content of the srcdoc
 *    document (see wrapWithCsp), so even if scripts are ever re-enabled
 *    there is no network egress.
 * 3. The app CSP (frame-src 'self') already blocks blob:/data: frames;
 *    srcdoc needs no CSP change.
 *
 * SVG is always rendered inside this iframe, never inline in the app DOM
 * (SVG can carry <script>).
 */

export function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation()
  const srcdoc = useMemo(() => {
    const document =
      artifact.kind === 'svg'
        ? wrapSvgDocument(artifact.content)
        : artifact.content
    return wrapWithCsp(document)
  }, [artifact.kind, artifact.content])

  return (
    <iframe
      sandbox=""
      srcDoc={srcdoc}
      title={t('common:artifacts.previewTitle')}
      className="h-full w-full border-0 bg-white"
    />
  )
}
