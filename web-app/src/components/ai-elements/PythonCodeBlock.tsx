import { type ReactNode, memo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useCodeExecution, type ExecutionResult } from '@/hooks/useCodeExecution'
import { Button } from '@/components/ui/button'
import { PlayIcon, RotateCcwIcon, LoaderCircleIcon, DownloadIcon, SquareTerminalIcon } from 'lucide-react'

const DANGEROUS_TAGS = new Set([
  'script', 'iframe', 'object', 'embed', 'form', 'meta', 'link', 'base',
  'applet', 'frame', 'frameset', 'layer', 'ilayer',
])

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Element) => {
    // Remove dangerous tags
    for (const el of Array.from(node.querySelectorAll('*'))) {
      if (DANGEROUS_TAGS.has(el.tagName.toLowerCase())) {
        el.remove()
        continue
      }
      // Remove all event handler attributes and javascript: URLs
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on') || (
          (name === 'href' || name === 'src' || name === 'action' || name === 'formaction' || name === 'xlink:href') &&
          attr.value.replace(/\s/g, '').toLowerCase().startsWith('javascript:')
        )) {
          el.removeAttribute(attr.name)
        }
      }
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

type PythonCodeBlockProps = {
  code: string
  children: ReactNode
  threadId?: string
}

function OutputImage({ data, index }: { data: string; index: number }) {
  const src = `data:image/png;base64,${data}`

  const download = useCallback(async () => {
    try {
      const savePath = await invoke<string | null>('save_dialog', {
        options: {
          default_path: `figure-${index + 1}.png`,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        },
      })
      if (!savePath) return

      const binary = atob(data)
      const hex = Array.from(binary, (c) =>
        c.charCodeAt(0).toString(16).padStart(2, '0')
      ).join('')

      await invoke('write_binary_file', { path: savePath, hexData: hex })
    } catch (err) {
      console.error('Failed to save image:', err)
    }
  }, [data, index])

  return (
    <div className="relative group/img inline-block w-full">
      <img
        src={src}
        alt={`Figure ${index + 1}`}
        className="max-w-full rounded-md border border-border"
      />
      <button
        onClick={download}
        title="Save image"
        className="absolute top-2 right-2 p-1 rounded-md bg-background/80 border border-border opacity-0 group-hover/img:opacity-100 transition-opacity hover:bg-muted"
      >
        <DownloadIcon size={14} className="text-muted-foreground" />
      </button>
    </div>
  )
}

function ExecutionOutput({ result }: { result: ExecutionResult }) {
  const hasStdout = result.stdout.trim().length > 0
  const hasError = !!(result.error || result.stderr.trim())

  return (
    <div className="rounded-b-xl border-x border-b border-border overflow-hidden bg-background -mt-[5px]">
      <div className="px-3 py-1 bg-muted/60 border-b border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Output
        </span>
      </div>
      <div className="p-3 space-y-3">
        {/* matplotlib / seaborn / PIL images */}
        {result.outputs
          .filter((o) => o.type === 'image')
          .map((o, i) => (
            <OutputImage key={i} data={o.data} index={i} />
          ))}

        {/* pandas DataFrames / plotly HTML */}
        {result.outputs
          .filter((o) => o.type === 'html')
          .map((o, i) => (
            <div
              key={i}
              className="overflow-x-auto text-xs [&_.dataframe]:w-full [&_.dataframe]:border-collapse [&_.dataframe_th]:px-3 [&_.dataframe_th]:py-1.5 [&_.dataframe_th]:bg-muted [&_.dataframe_th]:text-left [&_.dataframe_th]:font-semibold [&_.dataframe_th]:border [&_.dataframe_th]:border-border [&_.dataframe_td]:px-3 [&_.dataframe_td]:py-1.5 [&_.dataframe_td]:border [&_.dataframe_td]:border-border [&_.dataframe_tr:hover]:bg-muted/40"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: execution output, sanitized via DOM-based sanitizer
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(o.data) }}
            />
          ))}

        {/* plain text outputs */}
        {result.outputs
          .filter((o) => o.type === 'text')
          .map((o, i) => (
            <pre
              key={i}
              className="text-xs font-mono whitespace-pre-wrap break-words text-foreground"
            >
              {o.data}
            </pre>
          ))}

        {/* stdout — always shown when present */}
        {hasStdout && (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-foreground">
            {result.stdout}
          </pre>
        )}

        {/* stderr / traceback */}
        {hasError && (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-destructive bg-destructive/10 p-2 rounded-md">
            {result.error || result.stderr}
          </pre>
        )}

        {/* empty output */}
        {!hasStdout && result.outputs.length === 0 && !hasError && (
          <span className="text-xs text-muted-foreground italic">
            No output
          </span>
        )}
      </div>
    </div>
  )
}

export const PythonCodeBlock = memo(function PythonCodeBlock({
  code,
  children,
  threadId,
}: PythonCodeBlockProps) {
  const { state, execute, reset } = useCodeExecution(threadId)

  const isChecking = state.status === 'checking'
  const isRunning = state.status === 'running'
  const isBusy = isChecking || isRunning
  const isDone = state.status === 'done'
  const isError = state.status === 'error'
  const isUnavailable = state.status === 'python_unavailable'
  const showResults = isDone || isError

  const runLabel = () => {
    if (isChecking) return 'Checking…'
    if (isRunning) return 'Running…'
    return 'Run'
  }

  return (
    <div>
      {/* Streamdown renders the syntax-highlighted code block here */}
      <div className={showResults ? '[&>[data-streamdown=code-block]]:rounded-b-none [&>[data-streamdown=code-block]]:border-b-0 [&>[data-streamdown=code-block]]:mb-0' : ''}>
        {children}
      </div>

      {/* Python not available warning */}
      {isUnavailable && (
        <div className="flex items-center gap-2 px-3 py-2 mb-1 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 text-xs text-amber-700 dark:text-amber-400">
          <SquareTerminalIcon size={13} className="shrink-0" />
          Python is not installed or not in PATH. Please install Python, then click Run again.
        </div>
      )}

      {/* Run / Reset button row */}
      <div className="flex items-center gap-2 mb-1">
        {!isDone && !isError ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => !isBusy && execute(code)}
            disabled={isBusy}
          >
            {isBusy ? (
              <>
                <LoaderCircleIcon size={12} className="animate-spin" />
                {runLabel()}
              </>
            ) : (
              <>
                <PlayIcon size={12} />
                Run
              </>
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={reset}
          >
            <RotateCcwIcon size={12} />
            Run again
          </Button>
        )}
      </div>

      {/* Execution results */}
      {isDone && <ExecutionOutput result={state.result} />}
      {isError && (
        <div className="rounded-b-xl border-x border-b border-border p-3 bg-destructive/5 -mt-1">
          <pre className="text-xs text-destructive font-mono whitespace-pre-wrap break-words">
            {state.message}
          </pre>
        </div>
      )}
    </div>
  )
})
