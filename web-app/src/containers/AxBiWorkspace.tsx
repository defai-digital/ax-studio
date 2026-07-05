import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Database,
  FileSpreadsheet,
  LineChart,
  Plus,
  Play,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  runAxBiExistingDatasetChartWorkflow,
  runAxBiSdkPromptWorkflow,
} from '@/lib/ax-bi/dashboard-workflow'
import {
  DEFAULT_AX_BI_MCP_URL,
  connectAxBiMcpServer,
  getConfiguredAxBiMcpUrl,
  listAxBiDatasets,
  type AxBiDataset,
} from '@/lib/ax-bi/datasets'
import { cn } from '@/lib/utils'
import { useAxBiSessions } from '@/stores/ax-bi-session-store'

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function AxBiWorkspace() {
  const serviceHub = useServiceHub()
  const [mcpUrl, setMcpUrl] = useState(DEFAULT_AX_BI_MCP_URL)
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'error'
  >('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
  const [datasets, setDatasets] = useState<AxBiDataset[]>([])
  const [datasetsLoading, setDatasetsLoading] = useState(false)
  const [datasetSearch, setDatasetSearch] = useState('')
  const {
    sessions,
    activeSessionId,
    createSession,
    setActiveSession,
    updateSession,
    deleteSession,
    recordRun,
  } = useAxBiSessions()

  const sessionList = useMemo(
    () =>
      Object.values(sessions).sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      ),
    [sessions]
  )
  const activeSession =
    (activeSessionId ? sessions[activeSessionId] : undefined) ?? sessionList[0]

  useEffect(() => {
    const currentState = useAxBiSessions.getState()

    if (sessionList.length === 0) {
      if (Object.keys(currentState.sessions).length === 0) {
        createSession({ title: 'Sales dashboard' })
      }
      return
    }
    if ((!activeSessionId || !sessions[activeSessionId]) && sessionList[0]) {
      setActiveSession(sessionList[0].id)
    }
  }, [activeSessionId, createSession, sessionList, sessions, setActiveSession])

  useEffect(() => {
    let mounted = true
    getConfiguredAxBiMcpUrl(serviceHub)
      .then((url) => {
        if (mounted) setMcpUrl(url)
      })
      .catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [serviceHub])

  const filteredDatasets = useMemo(() => {
    const query = datasetSearch.trim().toLowerCase()
    if (!query) return datasets
    return datasets.filter((dataset) =>
      [dataset.name, dataset.schema, dataset.databaseName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))
    )
  }, [datasetSearch, datasets])

  async function refreshDatasets(search?: string) {
    setDatasetsLoading(true)
    setConnectionMessage('')
    try {
      const nextDatasets = await listAxBiDatasets({
        serviceHub,
        search,
      })
      setDatasets(nextDatasets)
      setConnectionStatus('connected')
      setConnectionMessage(`${nextDatasets.length} dataset${nextDatasets.length === 1 ? '' : 's'}`)
    } catch (error) {
      setConnectionStatus('error')
      setConnectionMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setDatasetsLoading(false)
    }
  }

  async function handleConnectAxBi() {
    setConnectionStatus('connecting')
    setConnectionMessage('')
    try {
      const normalizedUrl = await connectAxBiMcpServer({
        serviceHub,
        url: mcpUrl,
      })
      setMcpUrl(normalizedUrl)
      setConnectionStatus('connected')
      await refreshDatasets(datasetSearch)
    } catch (error) {
      setConnectionStatus('error')
      setConnectionMessage(error instanceof Error ? error.message : String(error))
    }
  }

  if (!activeSession) {
    return null
  }

  async function handleRunAnalysis() {
    const submittedPrompt = activeSession.prompt.trim()
    const submittedSource = activeSession.source.trim()

    if (submittedPrompt.length === 0 || activeSession.status === 'running') {
      return
    }

    const workflowPrompt = submittedSource
      ? `Use AX-BI MCP with dataset ${submittedSource}. ${submittedPrompt}`
      : `Use AX-BI to ${submittedPrompt}`

    updateSession(activeSession.id, { status: 'running' })

    try {
      const chartResult = await runAxBiExistingDatasetChartWorkflow({
        prompt: workflowPrompt,
        serviceHub,
      })
      if (chartResult.handled) {
        recordRun(activeSession.id, {
          status: 'ready',
          message: chartResult.message,
          prompt: submittedPrompt,
          url: chartResult.chartUrl,
        })
        return
      }

      const planResult = await runAxBiSdkPromptWorkflow({
        prompt: workflowPrompt,
        serviceHub,
      })
      recordRun(activeSession.id, {
        status: planResult.handled ? 'ready' : 'error',
        message: planResult.handled
          ? planResult.message
          : 'No AX-BI workflow matched this request.',
        prompt: submittedPrompt,
      })
    } catch (error) {
      recordRun(activeSession.id, {
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        prompt: submittedPrompt,
      })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground lg:flex-row">
      <aside className="flex h-56 w-full shrink-0 flex-col border-b border-border bg-muted/20 lg:h-full lg:w-72 lg:border-b-0 lg:border-r">
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            <h1 className="truncate text-sm font-semibold">Ax-BI</h1>
          </div>
          <Button
            aria-label="New Ax-BI session"
            size="icon-sm"
            variant="ghost"
            onClick={() => createSession({ title: 'Untitled analysis' })}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessionList.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveSession(session.id)}
              className={cn(
                'mb-1 grid w-full grid-cols-[1fr_auto] gap-2 rounded-md px-3 py-2 text-left transition-colors',
                session.id === activeSession.id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {session.title.trim() || 'Untitled analysis'}
                </span>
                <span className="mt-0.5 block truncate text-xs opacity-70">
                  {session.status === 'running'
                    ? 'Running'
                    : session.runs.length === 0
                      ? 'Draft'
                      : `${session.runs.length} run${session.runs.length === 1 ? '' : 's'}`}
                </span>
              </span>
              <span className="text-[11px] opacity-60">
                {formatTime(session.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="flex min-w-0 items-center gap-2">
            <LineChart className="size-4 text-primary" />
            <Input
              aria-label="Ax-BI session title"
              value={activeSession.title}
              onChange={(event) =>
                updateSession(activeSession.id, { title: event.target.value })
              }
              className="h-8 w-[min(420px,45vw)] border-transparent bg-transparent px-1 text-sm font-semibold shadow-none focus-visible:border-input"
            />
          </div>
          <Button
            aria-label="Delete Ax-BI session"
            size="icon-sm"
            variant="ghost"
            disabled={sessionList.length <= 1}
            onClick={() => deleteSession(activeSession.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(320px,420px)_1fr]">
          <section className="flex min-h-0 flex-col gap-4 overflow-y-auto border-r border-border p-5">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                MCP server
              </label>
              <div className="flex gap-2">
                <Input
                  value={mcpUrl}
                  placeholder={DEFAULT_AX_BI_MCP_URL}
                  onChange={(event) => setMcpUrl(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={connectionStatus === 'connecting'}
                  onClick={handleConnectAxBi}
                >
                  {connectionStatus === 'connecting' ? 'Connecting' : 'Connect'}
                </Button>
              </div>
              {connectionMessage ? (
                <div
                  className={cn(
                    'text-xs',
                    connectionStatus === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  {connectionMessage}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                  <Database className="size-3.5" />
                  Dataset
                </label>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={datasetsLoading}
                  onClick={() => refreshDatasets(datasetSearch)}
                >
                  {datasetsLoading ? 'Loading' : 'Refresh'}
                </Button>
              </div>
              <Input
                value={activeSession.source}
                placeholder="Select a dataset or type a dataset name"
                onChange={(event) =>
                  updateSession(activeSession.id, {
                    source: event.target.value,
                    status: 'draft',
                  })
                }
              />
              <Input
                value={datasetSearch}
                placeholder="Filter MCP datasets"
                onChange={(event) => setDatasetSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void refreshDatasets(datasetSearch)
                  }
                }}
              />
              {filteredDatasets.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  {filteredDatasets.map((dataset) => (
                    <button
                      key={String(dataset.id ?? dataset.name)}
                      type="button"
                      className={cn(
                        'flex w-full items-start justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60',
                        activeSession.source === dataset.name && 'bg-muted'
                      )}
                      onClick={() =>
                        updateSession(activeSession.id, {
                          source: dataset.name,
                          status: 'draft',
                        })
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {dataset.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[dataset.schema, dataset.databaseName]
                            .filter(Boolean)
                            .join(' / ') || 'AX-BI dataset'}
                        </span>
                      </span>
                      {dataset.id != null ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {dataset.id}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col space-y-2">
              <label className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                <FileSpreadsheet className="size-3.5" />
                Prompt
              </label>
              <Textarea
                value={activeSession.prompt}
                placeholder="Build a revenue dashboard by month, product, and region."
                onChange={(event) =>
                  updateSession(activeSession.id, {
                    prompt: event.target.value,
                    status: 'draft',
                  })
                }
                className="min-h-48 resize-none"
              />
            </div>

            <Button
              className="w-full"
              disabled={
                activeSession.prompt.trim().length === 0 ||
                activeSession.status === 'running'
              }
              onClick={handleRunAnalysis}
            >
              <Play className="size-4" />
              {activeSession.status === 'running' ? 'Running' : 'Run analysis'}
            </Button>
          </section>

          <section className="min-h-0 overflow-y-auto p-5">
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-md border border-border p-4">
                <div className="text-xs uppercase text-muted-foreground">
                  Status
                </div>
                <div className="mt-2 text-sm font-medium capitalize">
                  {activeSession.status}
                </div>
              </div>
              <div className="rounded-md border border-border p-4">
                <div className="text-xs uppercase text-muted-foreground">
                  Runs
                </div>
                <div className="mt-2 text-sm font-medium">
                  {activeSession.runs.length}
                </div>
              </div>
              <div className="rounded-md border border-border p-4">
                <div className="text-xs uppercase text-muted-foreground">
                  Updated
                </div>
                <div className="mt-2 text-sm font-medium">
                  {formatTime(activeSession.updatedAt)}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-border">
              <div className="flex h-11 items-center border-b border-border px-4 text-sm font-medium">
                Analysis runs
              </div>
              <div className="divide-y divide-border">
                {activeSession.runs.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No analysis runs yet
                  </div>
                ) : (
                  activeSession.runs.map((run) => (
                    <div key={run.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span>{formatTime(run.createdAt)}</span>
                        {run.url ? (
                          <a
                            href={run.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
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
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
