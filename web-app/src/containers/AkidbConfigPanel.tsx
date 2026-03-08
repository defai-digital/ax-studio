import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { IconDatabase, IconFolder } from '@tabler/icons-react'
import { Card, CardItem } from '@/containers/Card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useAkidbConfig } from '@/hooks/useAkidbConfig'
import { useAxStudioConfig } from '@/stores/useAxStudioConfig'

type AkidbStatus = {
  status: 'idle' | 'syncing' | 'error'
  config_loaded: boolean
  data_folder: string | null
  last_sync_at: string | null
  total_files: number
  indexed_files: number
  pending_files: number
  error_files: number
}

const FREQUENCY_OPTIONS = [
  { label: 'Real-time (on file change)', value: 0 },
  { label: 'Every 30 minutes', value: 30 },
  { label: 'Every hour', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Once a day', value: 1440 },
]

export default function AkidbConfigPanel() {
  const { config, loading, saving, load, save } = useAkidbConfig()
  const akidbUrl = useAxStudioConfig((s) => s.config.akidbUrl)

  const [dataFolder, setDataFolder] = useState('')
  const [frequency, setFrequency] = useState(60)
  const [akidbStatus, setAkidbStatus] = useState<AkidbStatus | null>(null)

  // Load config from ~/.akidb/config.yaml on mount
  useEffect(() => {
    load()
  }, [load])

  // Sync form fields when config is loaded from disk
  useEffect(() => {
    if (config) {
      setDataFolder(config['data-folder'] ?? '')
      setFrequency(config.frequency ?? 60)
    }
  }, [config])

  // Poll AkiDB GET /status every 5 seconds to show live sync state
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${akidbUrl}/status`)
        if (res.ok) {
          setAkidbStatus(await res.json())
        } else {
          setAkidbStatus(null)
        }
      } catch {
        setAkidbStatus(null) // AkiDB not running — hide status section silently
      }
    }

    poll()
    const intervalId = setInterval(poll, 5_000)
    return () => clearInterval(intervalId)
  }, [akidbUrl])

  // Open native folder picker via Tauri open_dialog command
  const handleBrowse = async () => {
    try {
      const result = await invoke<string | null>('open_dialog', {
        options: { directory: true },
      })
      if (result) setDataFolder(result)
    } catch {
      toast.error('Folder picker is not available in this environment')
    }
  }

  // Write ~/.akidb/config.yaml
  const handleSave = async () => {
    if (!dataFolder.trim()) {
      toast.error('Please select a data folder')
      return
    }
    try {
      await save({ 'data-folder': dataFolder.trim(), frequency })
      toast.success('AkiDB config saved — changes will be picked up automatically')
    } catch {
      toast.error('Failed to save AkiDB config')
    }
  }

  if (loading) {
    return (
      <Card
        header={
          <div className="mb-3 flex w-full items-center gap-3">
            <IconDatabase size={20} className="shrink-0 text-muted-foreground" />
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
          <IconDatabase size={20} className="shrink-0 text-muted-foreground" />
          <h1 className="text-foreground font-medium text-base">
            Knowledge Base Sync
          </h1>
        </div>
      }
    >
      {/* Data folder row */}
      <CardItem
        title="Data Folder"
        description="AkiDB will watch this folder and automatically index all supported files into your knowledge base."
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
        description="How often AkiDB runs a full reconciliation scan of your data folder."
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

      {/* Save button */}
      <div className="flex mt-2 justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Live status — only shown when AkiDB is reachable */}
      {akidbStatus && (
        <div className="mt-4 rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {akidbStatus.status === 'syncing'
              ? 'Syncing...'
              : akidbStatus.status === 'error'
                ? 'Sync error'
                : 'Up to date'}
          </p>
          <p className="text-xs text-muted-foreground">
            {akidbStatus.indexed_files} indexed
            {akidbStatus.pending_files > 0 &&
              ` · ${akidbStatus.pending_files} pending`}
            {akidbStatus.error_files > 0 &&
              ` · ${akidbStatus.error_files} errors`}
            {' '}/{' '}{akidbStatus.total_files} total
          </p>
          {akidbStatus.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(akidbStatus.last_sync_at).toLocaleString()}
            </p>
          )}
          {!akidbStatus.config_loaded && (
            <p className="text-xs text-amber-500">
              AkiDB has not loaded the config yet — save your settings above.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
