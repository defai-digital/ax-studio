import { type ReactNode, memo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useCodeExecution, type ExecutionResult } from '@/hooks/useCodeExecution'
import { Button } from '@/components/ui/button'
import { PlayIcon, RotateCcwIcon, LoaderCircleIcon, DownloadIcon } from 'lucide-react'

type PythonCodeBlockProps = {
  code: string
  children: ReactNode
}

function OutputImage({ data, index }: { data: string; index: number }) {
  const src = `data:image/png;base64,${data}`

  const download = useCallback(async () => {
    try {
      // Open native save dialog
      const savePath = await invoke<string | null>('save_dialog', {
        options: {
          default_path: `figure-${index + 1}.png`,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        },
      })
      if (!savePath) return

      // Convert base64 → hex (write_binary_file expects hex-encoded bytes)
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
              className="overflow-x-auto text-xs"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted local execution output
              dangerouslySetInnerHTML={{ __html: o.data }}
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
}: PythonCodeBlockProps) {
  const { state, execute, reset } = useCodeExecution()
  const isRunning = state.status === 'running'
  const isDone = state.status === 'done'
  const isError = state.status === 'error'
  const showResults = isDone || isError

  return (
    <div>
      {/* Streamdown renders the syntax-highlighted code block here */}
      <div className={showResults ? '[&>[data-streamdown=code-block]]:rounded-b-none [&>[data-streamdown=code-block]]:border-b-0 [&>[data-streamdown=code-block]]:mb-0' : ''}>
        {children}
      </div>

      {/* Run / Reset button row */}
      <div className="flex items-center gap-2 mb-1">
        {!isDone && !isError ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => !isRunning && execute(code)}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <LoaderCircleIcon size={12} className="animate-spin" />
                Running…
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
