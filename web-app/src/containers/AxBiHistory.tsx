import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Database, Loader2, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { localStorageKey } from '@/constants/localStorage'
import { useServiceHub } from '@/hooks/useServiceHub'
import { runAxBiAuthoringWorkflow } from '@/lib/ax-bi/authoring-workflow'
import { listAxBiDatasets, type AxBiDataset } from '@/lib/ax-bi/datasets'
import { recordAxBiChatRun } from '@/lib/ax-bi/run-history'
import { normalizeAxBiResultUrl } from '@/lib/ax-bi/tool-navigation'
import {
  safeStorageGetItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'
import { cn } from '@/lib/utils'
import { useAxBiConnection } from '@/stores/ax-bi-connection-store'
import { useAxBiSessions } from '@/stores/ax-bi-session-store'
import { AxBiConnectCard } from './AxBiConnectCard'

const LAST_DATASET_STORAGE_CONTEXT = 'AX BI last dataset'

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

/**
 * Slim AX BI page (migration matrix §4): the chat is the primary entry
 * point, so this page is only a run-history view (chat delegations and quick
 * runs) plus the zero-config connect card.
 */
export function AxBiHistory() {
  const serviceHub = useServiceHub()
  const status = useAxBiConnection((state) => state.status)
  const sessions = useAxBiSessions((state) => state.sessions)
  const [prompt, setPrompt] = useState('')
  const [dataset, setDataset] = useState(
    () =>
      safeStorageGetItem(
        localStorage,
        localStorageKey.axBiLastDataset,
        LAST_DATASET_STORAGE_CONTEXT
      ) ?? ''
  )
  const [datasets, setDatasets] = useState<AxBiDataset[]>([])
  const [datasetsLoading, setDatasetsLoading] = useState(false)
  const [running, setRunning] = useState(false)

  const connected = status === 'connected'

  const sessionList = useMemo(
    () =>
      Object.values(sessions)
        .filter((session) => session.runs.length > 0)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [sessions]
  )

  const refreshDatasets = useCallback(async () => {
    setDatasetsLoading(true)
    try {
      setDatasets(await listAxBiDatasets())
    } catch {
      // Dataset suggestions are a convenience; the text input still works.
    } finally {
      setDatasetsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (connected) void refreshDatasets()
  }, [connected, refreshDatasets])

  async function handleRun() {
    const submittedPrompt = prompt.trim()
    const submittedSource = dataset.trim()
    if (!submittedPrompt || running) return

    if (submittedSource) {
      // Remember the last-used dataset as the default for the next run.
      safeStorageSetItem(
        localStorage,
        localStorageKey.axBiLastDataset,
        submittedSource,
        LAST_DATASET_STORAGE_CONTEXT
      )
    }

    const workflowPrompt = submittedSource
      ? `Use AX BI MCP with dataset ${submittedSource}. ${submittedPrompt}`
      : `Use AX BI to ${submittedPrompt}`

    setRunning(true)
    try {
      const result = await runAxBiAuthoringWorkflow({
        prompt: workflowPrompt,
        force: true,
      })
      const failed =
        result.handled &&
        (result.status === 'failed' || result.status === 'blocked')
      recordAxBiChatRun({
        prompt: submittedPrompt,
        message: result.handled
          ? result.message
          : 'No AX BI workflow matched this request.',
        status: result.handled && !failed ? 'ready' : 'error',
        url: result.handled ? result.artifactUrl : undefined,
      })
      if (result.handled && !failed) setPrompt('')
    } catch (error) {
      recordAxBiChatRun({
        prompt: submittedPrompt,
        message: error instanceof Error ? error.message : String(error),
        status: 'error',
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col bg-background text-foreground',
        IS_MACOS && 'pt-15'
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        <BarChart3 className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">AX BI</h1>
        <Badge variant="amber" className="px-1.5 py-0 text-[10px]">
          Beta
        </Badge>
      </header>

      <main className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        {!connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              AX BI works from the chat: ask for a chart or dashboard and Studio
              delegates it to your local AX BI stack. Connect once to get
              started.
            </p>
            <AxBiConnectCard />
          </>
        ) : (
          <>
            <section className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="ax-bi-history-dataset"
                  className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"
                >
                  <Database className="size-3.5" />
                  Dataset
                </label>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={datasetsLoading}
                  onClick={() => void refreshDatasets()}
                >
                  {datasetsLoading ? 'Loading' : 'Refresh'}
                </Button>
              </div>
              <Input
                id="ax-bi-history-dataset"
                className="mt-2"
                value={dataset}
                placeholder="Dataset name (optional — remembered for next time)"
                list="ax-bi-history-datasets"
                onChange={(event) => setDataset(event.target.value)}
              />
              <datalist id="ax-bi-history-datasets">
                {datasets.map((item) => (
                  <option key={String(item.id ?? item.name)} value={item.name} />
                ))}
              </datalist>
              <Textarea
                aria-label="AX BI quick run prompt"
                className="mt-3 min-h-20 resize-none"
                value={prompt}
                placeholder="Build a revenue dashboard by month, product, and region."
                onChange={(event) => setPrompt(event.target.value)}
              />
              <Button
                className="mt-3 w-full"
                disabled={!prompt.trim() || running}
                onClick={() => void handleRun()}
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Running
                  </>
                ) : (
                  <>
                    <Play className="size-4" />
                    Run analysis
                  </>
                )}
              </Button>
            </section>

            <section>
              <h2 className="text-xs font-medium uppercase text-muted-foreground">
                Run history
              </h2>
              {sessionList.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No runs yet. Ask for a chart or dashboard in the chat, or use
                  the quick run above.
                </p>
              ) : (
                <div className="mt-3 space-y-4">
                  {sessionList.map((session) => (
                    <div
                      key={session.id}
                      className="rounded-md border border-border"
                    >
                      <div className="flex h-10 items-center justify-between border-b border-border px-4">
                        <span className="truncate text-sm font-medium">
                          {session.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatTime(session.updatedAt)}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {session.runs.map((run) => {
                          const safeUrl = run.url
                            ? normalizeAxBiResultUrl(run.url)
                            : undefined
                          return (
                            <div key={run.id} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      'size-1.5 rounded-full',
                                      run.status === 'ready'
                                        ? 'bg-emerald-500'
                                        : 'bg-destructive'
                                    )}
                                  />
                                  {formatTime(run.createdAt)}
                                </span>
                                {safeUrl ? (
                                  <a
                                    href={safeUrl}
                                    className="text-primary hover:underline"
                                    onClick={(event) => {
                                      // Webviews do not honor target=_blank for
                                      // external BI URLs; open via the opener
                                      // bridge (shell.openExternal on Electron).
                                      event.preventDefault()
                                      void serviceHub.opener().openUrl(safeUrl)
                                    }}
                                  >
                                    Open result
                                  </a>
                                ) : null}
                              </div>
                              <div className="mt-1 line-clamp-2 text-sm">
                                {run.prompt}
                              </div>
                              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                                {run.message}
                              </pre>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
