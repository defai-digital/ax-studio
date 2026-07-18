import { useEffect, useMemo, useRef, useState } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronDown,
  Code2,
  Download,
  Globe,
  Image as ImageIcon,
  SquarePen,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { ArtifactPreview } from '@/components/artifacts/ArtifactPreview'
import { CopyButton } from '@/components/common/CopyButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useArtifactPanel } from '@/stores/artifact-panel-store'
import { usePrompt } from '@/hooks/ui/usePrompt'
import {
  extractArtifactsFromTextParts,
  type Artifact,
  type ArtifactKind,
} from '@/lib/artifacts/extract-artifacts'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

/**
 * ArtifactPanel — right-hand side panel rendering artifact candidates
 * (long code fences, html/svg/mermaid blocks) derived live from the
 * thread's assistant messages. Mounted once per threadId in ThreadView;
 * state lives in useArtifactPanel so Split View panes stay independent.
 */

const KIND_ICONS: Record<ArtifactKind, LucideIcon> = {
  code: Code2,
  html: Globe,
  svg: ImageIcon,
  mermaid: Workflow,
}

/** File extension per kind, with a small language map for code artifacts. */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  java: 'java',
  rust: 'rs',
  go: 'go',
  ruby: 'rb',
  shell: 'sh',
  bash: 'sh',
  json: 'json',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  sql: 'sql',
  markdown: 'md',
}

function artifactExtension(artifact: Artifact): string {
  if (artifact.kind === 'html') return 'html'
  if (artifact.kind === 'svg') return 'svg'
  if (artifact.kind === 'mermaid') return 'mmd'
  return LANGUAGE_EXTENSIONS[artifact.language] ?? (artifact.language || 'txt')
}

export const REVISE_CONTEXT_LIMIT = 4000
export const REVISE_CONTEXT_WINDOW = 500

/**
 * Build the composer prefill for a targeted ("revise this selection") edit.
 * Artifacts longer than REVISE_CONTEXT_LIMIT are narrowed to ±500 chars
 * around the selection (when it can be located) to keep the prompt small.
 */
export function buildRevisePrompt({
  kind,
  content,
  selection,
  instruction,
}: {
  kind: ArtifactKind
  content: string
  selection: string
  instruction: string
}): string {
  let artifactBody = content
  if (content.length > REVISE_CONTEXT_LIMIT) {
    const at = content.indexOf(selection)
    if (at !== -1) {
      const start = Math.max(0, at - REVISE_CONTEXT_WINDOW)
      const end = Math.min(
        content.length,
        at + selection.length + REVISE_CONTEXT_WINDOW
      )
      artifactBody = `${start > 0 ? '…\n' : ''}${content.slice(start, end)}${
        end < content.length ? '\n…' : ''
      }`
    }
  }

  return `Regarding this ${kind} artifact:\n\n<artifact>\n${artifactBody}\n</artifact>\n\nFor this part:\n<selection>\n${selection}\n</selection>\n\n${instruction}`
}

export type ArtifactPanelProps = {
  threadId: string
  messages: UIMessage[]
}

export function ArtifactPanel({ threadId, messages }: ArtifactPanelProps) {
  const { t } = useTranslation()
  const panel = useArtifactPanel((s) => s.panels[threadId])
  const closePanel = useArtifactPanel((s) => s.closePanel)
  const setActive = useArtifactPanel((s) => s.setActive)
  const setPrompt = usePrompt((s) => s.setPrompt)

  // Artifacts are derived live from the messages — nothing persisted.
  const artifactsByMessage = useMemo(() => {
    const map = new Map<string, Artifact[]>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const artifacts = extractArtifactsFromTextParts(
        message.id,
        message.parts as ReadonlyArray<{ type: string; text?: unknown }>
      )
      if (artifacts.length > 0) map.set(message.id, artifacts)
    }
    return map
  }, [messages])

  const allArtifacts = useMemo(
    () => [...artifactsByMessage.values()].flat(),
    [artifactsByMessage]
  )

  const activeArtifact =
    allArtifacts.find((a) => a.id === panel?.activeArtifactId) ??
    allArtifacts[allArtifacts.length - 1]

  const siblings = activeArtifact
    ? (artifactsByMessage.get(activeArtifact.messageId) ?? [activeArtifact])
    : []

  // html/svg default to a sandboxed preview; "Code" toggle shows the source.
  const [viewMode, setViewMode] = useState<'preview' | 'code'>('preview')
  useEffect(() => {
    setViewMode('preview')
  }, [activeArtifact?.id])

  const isPreviewable =
    activeArtifact?.kind === 'html' || activeArtifact?.kind === 'svg'
  const showCodeView = Boolean(
    activeArtifact && (!isPreviewable || viewMode === 'code')
  )

  // ── Revise selection ──────────────────────────────────────────────────
  // Selection is only reachable in the code view (iframe selections can't
  // cross the sandbox boundary), so the floating box only appears there.
  const contentRef = useRef<HTMLDivElement>(null)
  const reviseBoxRef = useRef<HTMLDivElement>(null)
  const [capturedSelection, setCapturedSelection] = useState('')
  const [instruction, setInstruction] = useState('')

  useEffect(() => {
    const onSelectionChange = () => {
      const container = contentRef.current
      const selection = window.getSelection()
      if (
        container &&
        selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        container.contains(selection.anchorNode)
      ) {
        setCapturedSelection(selection.toString())
        return
      }
      // Keep the captured selection while the user interacts with the
      // floating revise box (clicking it collapses the text selection).
      if (reviseBoxRef.current?.contains(document.activeElement)) return
      setCapturedSelection('')
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () =>
      document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  // Switching artifacts invalidates any captured selection.
  useEffect(() => {
    setCapturedSelection('')
    setInstruction('')
  }, [activeArtifact?.id])

  const clearRevise = () => {
    setCapturedSelection('')
    setInstruction('')
    window.getSelection()?.removeAllRanges()
  }

  const handleReviseSubmit = () => {
    const selectionText = capturedSelection.trim()
    const instructionText = instruction.trim()
    if (!activeArtifact || !selectionText || !instructionText) return
    setPrompt(
      buildRevisePrompt({
        kind: activeArtifact.kind,
        content: activeArtifact.content,
        selection: selectionText,
        instruction: instructionText,
      })
    )
    clearRevise()
    document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus()
  }

  // Esc closes the panel.
  const isOpen = Boolean(panel?.open)
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel(threadId)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, threadId, closePanel])

  const handleDownload = () => {
    if (!activeArtifact) return
    const blob = new Blob([activeArtifact.content], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `artifact-${activeArtifact.id.replace(/[^a-z0-9-]/gi, '-')}.${artifactExtension(activeArtifact)}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const ActiveIcon = activeArtifact ? KIND_ICONS[activeArtifact.kind] : Code2

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.aside
          key="artifact-panel"
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex h-full w-[420px] xl:w-[520px] shrink-0 flex-col border-l bg-background"
          aria-label={t('common:artifacts.panelTitle')}
        >
          {/* Header: kind icon + language + line count, thread list, close */}
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <ActiveIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">
              {activeArtifact
                ? activeArtifact.language ||
                  t(`common:artifacts.kind.${activeArtifact.kind}`)
                : t('common:artifacts.panelTitle')}
            </span>
            {activeArtifact && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('common:artifacts.lines', {
                  count: activeArtifact.lineCount,
                })}
              </span>
            )}

            {artifactsByMessage.size > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 text-muted-foreground/70 hover:text-foreground"
                    title={t('common:artifacts.allArtifacts')}
                    aria-label={t('common:artifacts.allArtifacts')}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[...artifactsByMessage.entries()].map(
                    ([messageId, artifacts], index) => (
                      <DropdownMenuItem
                        key={messageId}
                        onSelect={() => setActive(threadId, artifacts[0].id)}
                      >
                        {t('common:artifacts.messageLabel', {
                          index: index + 1,
                          count: artifacts.length,
                        })}
                      </DropdownMenuItem>
                    )
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div className="ml-auto shrink-0">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => closePanel(threadId)}
                title={t('common:artifacts.close')}
                aria-label={t('common:artifacts.close')}
                className="text-muted-foreground/70 hover:text-foreground"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {/* Tab row: artifacts of the same message + preview/code toggle */}
          {activeArtifact && (siblings.length > 1 || isPreviewable) && (
            <div className="flex items-center gap-1 border-b px-2 py-1">
              {siblings.length > 1 &&
                siblings.map((artifact, index) => {
                  const TabIcon = KIND_ICONS[artifact.kind]
                  const isActive = artifact.id === activeArtifact.id
                  return (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => setActive(threadId, artifact.id)}
                      aria-pressed={isActive}
                      className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                        isActive
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60'
                      )}
                    >
                      <TabIcon className="size-3.5" />
                      <span>
                        {artifact.language ||
                          t(`common:artifacts.kind.${artifact.kind}`)}{' '}
                        {index + 1}
                      </span>
                    </button>
                  )
                })}

              {isPreviewable && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('preview')}
                    aria-pressed={viewMode === 'preview'}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs',
                      viewMode === 'preview'
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60'
                    )}
                  >
                    {t('common:artifacts.preview')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('code')}
                    aria-pressed={viewMode === 'code'}
                    className={cn(
                      'rounded-md px-2 py-1 text-xs',
                      viewMode === 'code'
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60'
                    )}
                  >
                    {t('common:artifacts.code')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Content */}
          <div className="relative flex-1 overflow-hidden">
            {!activeArtifact && (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t('common:artifacts.empty')}
              </div>
            )}

            {activeArtifact && isPreviewable && viewMode === 'preview' && (
              <ArtifactPreview artifact={activeArtifact} />
            )}

            {activeArtifact && showCodeView && (
              <div
                ref={contentRef}
                className="h-full overflow-auto px-3 py-2"
                data-testid="artifact-code-view"
              >
                <RenderMarkdown
                  content={`\`\`\`${activeArtifact.language}\n${activeArtifact.content}\n\`\`\``}
                />
              </div>
            )}

            {/* Floating revise box — appears on code-view selection */}
            {activeArtifact && showCodeView && capturedSelection && (
              <div
                ref={reviseBoxRef}
                className="absolute inset-x-3 bottom-3 rounded-lg border bg-popover p-2 shadow-lg"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {t('common:artifacts.reviseHint')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={clearRevise}
                    aria-label={t('common:artifacts.reviseDismiss')}
                    title={t('common:artifacts.reviseDismiss')}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleReviseSubmit()
                  }}
                >
                  <input
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder={t('common:artifacts.revisePlaceholder')}
                    aria-label={t('common:artifacts.revisePlaceholder')}
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    type="submit"
                    size="icon-sm"
                    disabled={!instruction.trim()}
                    aria-label={t('common:artifacts.reviseSubmit')}
                    title={t('common:artifacts.reviseSubmit')}
                  >
                    <SquarePen className="size-4" />
                  </Button>
                </form>
              </div>
            )}
          </div>

          {/* Footer actions */}
          {activeArtifact && (
            <div className="flex items-center gap-0.5 border-t px-2 py-1.5">
              <CopyButton text={activeArtifact.content} />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleDownload}
                title={t('common:artifacts.download')}
                aria-label={t('common:artifacts.download')}
                className="text-muted-foreground/70 hover:text-foreground"
              >
                <Download className="size-4" />
              </Button>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
