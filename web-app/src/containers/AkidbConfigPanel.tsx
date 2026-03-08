import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { IconDatabase, IconFolder } from '@tabler/icons-react'
import { Card, CardItem } from '@/containers/Card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  useAkidbConfig,
  createDefaultConfig,
  type AkidbConfig,
} from '@/hooks/useAkidbConfig'

const FREQUENCY_OPTIONS = [
  { label: 'Every 10 minutes', value: 10 },
  { label: 'Every 30 minutes', value: 30 },
  { label: 'Every hour', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Once a day', value: 1440 },
]

const EMBEDDING_MODEL_OPTIONS = [
  { label: 'gte-qwen2-1.5b-instruct-q4_k_m (Local, 1536d)', value: 'gte-qwen2-1.5b-instruct-q4_k_m', dimension: 1536 },
  { label: 'all-minilm-l6-v2-q4_k_m (Local, 384d)', value: 'all-minilm-l6-v2-q4_k_m', dimension: 384 },
  { label: 'text-embedding-3-small (OpenAI, 1536d)', value: 'text-embedding-3-small', dimension: 1536 },
  { label: 'text-embedding-3-large (OpenAI, 3072d)', value: 'text-embedding-3-large', dimension: 3072 },
  { label: 'text-embedding-ada-002 (OpenAI, 1536d)', value: 'text-embedding-ada-002', dimension: 1536 },
]

export default function AkidbConfigPanel() {
  const { config, status, loading, saving, load, save, loadStatus } =
    useAkidbConfig()

  const [dataFolder, setDataFolder] = useState('')
  const [frequency, setFrequency] = useState(60)
  const [embeddingModel, setEmbeddingModel] = useState('gte-qwen2-1.5b-instruct-q4_k_m')
  const [embeddingDimension, setEmbeddingDimension] = useState(1536)

  // Load config from ~/.ax-fabric/config.yaml on mount
  useEffect(() => {
    load()
  }, [load])

  // Sync form fields when config is loaded from disk
  useEffect(() => {
    if (config) {
      const firstSource = config.ingest?.sources?.[0]?.path ?? ''
      setDataFolder(firstSource)
      setFrequency(config.schedule?.interval_minutes ?? 60)
      setEmbeddingModel(config.embedder?.model_id ?? 'text-embedding-3-small')
      setEmbeddingDimension(config.embedder?.dimension ?? 1536)
    }
  }, [config])

  // Poll daemon status via Tauri command every 5 seconds
  useEffect(() => {
    loadStatus()
    const intervalId = setInterval(loadStatus, 5_000)
    return () => clearInterval(intervalId)
  }, [loadStatus])

  // Open native folder picker via Tauri open_dialog command
  const handleBrowse = useCallback(async () => {
    try {
      const result = await invoke<string | null>('open_dialog', {
        options: { directory: true },
      })
      if (result) setDataFolder(result)
    } catch {
      toast.error('Folder picker is not available in this environment')
    }
  }, [])

  // Handle embedding model change — sync dimension automatically
  const handleModelChange = useCallback(
    (modelId: string) => {
      setEmbeddingModel(modelId)
      const found = EMBEDDING_MODEL_OPTIONS.find((m) => m.value === modelId)
      if (found) setEmbeddingDimension(found.dimension)
    },
    [],
  )

  // Build and write full ~/.ax-fabric/config.yaml
  const handleSave = useCallback(async () => {
    if (!dataFolder.trim()) {
      toast.error('Please select a data folder')
      return
    }

    const newConfig: AkidbConfig = config
      ? {
          ...config,
          ingest: {
            ...config.ingest,
            sources: [{ path: dataFolder.trim() }],
          },
          embedder: {
            ...config.embedder,
            type: 'http',
            model_id: embeddingModel,
            dimension: embeddingDimension,
            base_url: 'http://127.0.0.1:18080',
            batch_size: config.embedder?.batch_size ?? 4,
            timeout_ms: config.embedder?.timeout_ms ?? 120000,
          },
          akidb: {
            ...config.akidb,
            dimension: embeddingDimension,
          },
          schedule: {
            interval_minutes: frequency,
          },
        }
      : {
          ...createDefaultConfig(dataFolder.trim()),
          embedder: {
            type: 'http' as const,
            model_id: embeddingModel,
            dimension: embeddingDimension,
            batch_size: 4,
            timeout_ms: 120000,
            base_url: 'http://127.0.0.1:18080',
          },
          akidb: {
            ...createDefaultConfig().akidb,
            dimension: embeddingDimension,
          },
          schedule: {
            interval_minutes: frequency,
          },
        }

    try {
      await save(newConfig)
      toast.success(
        'Knowledge base config saved — the daemon will pick up changes automatically',
      )
    } catch {
      toast.error('Failed to save knowledge base config')
    }
  }, [config, dataFolder, embeddingModel, embeddingDimension, frequency, save])

  if (loading) {
    return (
      <Card
        header={
          <div className="mb-3 flex w-full items-center gap-3">
            <IconDatabase
              size={20}
              className="shrink-0 text-muted-foreground"
            />
            <h1 className="text-foreground font-medium text-base">
              Knowledge Base Sync
            </h1>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">Loading config...</p>
      </Card>
    )
  }

  return (
    <Card
      header={
        <div className="mb-3 flex w-full items-center gap-3">
          <IconDatabase
            size={20}
            className="shrink-0 text-muted-foreground"
          />
          <h1 className="text-foreground font-medium text-base">
            Knowledge Base Sync
          </h1>
        </div>
      }
    >
      {/* Data folder row */}
      <CardItem
        title="Data Folder"
        description="The folder to watch and index into your knowledge base."
        align="start"
        column
        actions={
          <div className="flex w-full items-center gap-2 pt-2">
            <Input
              className="h-8 flex-1 text-sm font-mono"
              value={dataFolder}
              onChange={(e) => setDataFolder(e.target.value)}
              placeholder="/Users/me/Documents/MyKnowledgeBase"
            />
            <Button variant="outline" size="sm" onClick={handleBrowse}>
              <IconFolder size={14} className="mr-1" />
              Browse
            </Button>
          </div>
        }
      />

      {/* Sync frequency row */}
      <CardItem
        title="Sync Frequency"
        description="How often a full reconciliation scan runs."
        actions={
          <select
            value={frequency}
            onChange={(e) => setFrequency(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        }
      />

      {/* Embedding model row */}
      <CardItem
        title="Embedding Model"
        description="Model used for generating embeddings. Uses Ax-Studio's proxy so your existing API keys work automatically."
        actions={
          <select
            value={embeddingModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {EMBEDDING_MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        }
      />

      {/* Save button */}
      <div className="flex mt-2 justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Live status — shown when daemon status file exists */}
      {status && (
        <div className="mt-4 rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {status.status === 'syncing'
              ? 'Syncing...'
              : status.status === 'error'
                ? 'Sync error'
                : 'Up to date'}
          </p>
          <p className="text-xs text-muted-foreground">
            {status.indexed_files} indexed
            {status.pending_files > 0 &&
              ` · ${status.pending_files} pending`}
            {status.error_files > 0 && ` · ${status.error_files} errors`}
            {' '}/{' '}
            {status.total_files} total
          </p>
          {status.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(status.last_sync_at).toLocaleString()}
            </p>
          )}
          {!status.config_loaded && (
            <p className="text-xs text-amber-500">
              The daemon has not loaded the config yet — save your settings
              above.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
