import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Brain } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardItem } from '@/containers/Card'
import { useMemory, MEMORY_LIMIT } from '@/hooks/useMemory'
import type { MemoryEntry } from '@/hooks/useMemory'
import { IconTrash, IconCheck, IconX, IconSearch, IconDownload, IconUpload, IconMessage } from '@tabler/icons-react'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.memory as any)({
  component: MemorySettings,
})

function formatCategory(category: string): string {
  return category.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function MemoryRow({
  entry,
  onUpdate,
  onDelete,
  onNavigateToThread,
}: {
  entry: MemoryEntry
  onUpdate: (id: string, fact: string) => void
  onDelete: (id: string) => void
  onNavigateToThread: (threadId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(entry.fact)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== entry.fact) {
      onUpdate(entry.id, trimmed)
    }
    setEditing(false)
  }, [editValue, entry.fact, entry.id, onUpdate])

  const handleCancel = useCallback(() => {
    setEditValue(entry.fact)
    setEditing(false)
  }, [entry.fact])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSave()
      if (e.key === 'Escape') handleCancel()
    },
    [handleSave, handleCancel]
  )

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      {editing ? (
        <>
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className="h-7 flex-1 text-sm"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={handleSave}
          >
            <IconCheck size={14} className="text-green-500" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCancel}
          >
            <IconX size={14} className="text-muted-foreground" />
          </Button>
        </>
      ) : (
        <>
          {entry.category && (
            <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5 shrink-0">
              {formatCategory(entry.category)}
            </span>
          )}
          <span
            className="flex-1 cursor-pointer truncate text-sm text-foreground"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {entry.fact}
          </span>
          {entry.sourceThreadId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
              onClick={() => onNavigateToThread(entry.sourceThreadId)}
              title="Go to source thread"
            >
              <IconMessage size={14} className="text-muted-foreground" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={() => onDelete(entry.id)}
          >
            <IconTrash size={14} className="text-destructive" />
          </Button>
        </>
      )}
    </div>
  )
}

const EMPTY_MEMORIES: MemoryEntry[] = []

function MemorySettings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const memoryEnabled = useMemory((state) => state.memoryEnabled)
  const toggleMemory = useMemory((state) => state.toggleMemory)
  const memories = useMemory((state) => state.memories['default'] ?? EMPTY_MEMORIES)
  const updateMemory = useMemory((state) => state.updateMemory)
  const deleteMemory = useMemory((state) => state.deleteMemory)
  const clearMemories = useMemory((state) => state.clearMemories)
  const importMemories = useMemory((state) => state.importMemories)

  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories
    const q = searchQuery.toLowerCase()
    return memories.filter(
      (m) =>
        m.fact.toLowerCase().includes(q) ||
        (m.category && m.category.toLowerCase().includes(q))
    )
  }, [memories, searchQuery])

  const handleUpdate = useCallback(
    (id: string, fact: string) => {
      updateMemory('default', id, fact)
    },
    [updateMemory]
  )

  const handleDelete = useCallback(
    (id: string) => {
      deleteMemory('default', id)
    },
    [deleteMemory]
  )

  const handleClearAll = useCallback(() => {
    clearMemories('default')
  }, [clearMemories])

  const handleNavigateToThread = useCallback(
    (threadId: string) => {
      navigate({ to: '/threads/$threadId', params: { threadId } })
    },
    [navigate]
  )

  const handleExport = useCallback(() => {
    const json = JSON.stringify(memories, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ax-studio-memories-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`Exported ${memories.length} memories`)
  }, [memories])

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string)
          if (!Array.isArray(parsed)) {
            toast.error('Invalid file: expected a JSON array of memories')
            return
          }
          // Validate each entry has at minimum id, fact, createdAt, updatedAt
          const valid = parsed.every(
            (entry: unknown) =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as MemoryEntry).id === 'string' &&
              typeof (entry as MemoryEntry).fact === 'string' &&
              typeof (entry as MemoryEntry).createdAt === 'number' &&
              typeof (entry as MemoryEntry).updatedAt === 'number'
          )
          if (!valid) {
            toast.error('Invalid file: entries must have id, fact, createdAt, and updatedAt')
            return
          }
          importMemories('default', parsed as MemoryEntry[])
          toast.success(`Imported ${parsed.length} memories`)
        } catch {
          toast.error('Failed to parse JSON file')
        }
      }
      reader.onerror = () => {
        toast.error('Failed to read file')
      }
      reader.readAsText(file)
      // Reset the input so the same file can be re-imported
      e.target.value = ''
    },
    [importMemories]
  )

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">Settings</span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Brain className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-foreground tracking-tight" style={{ fontSize: '16px', fontWeight: 600 }}>
              {t('common:memory')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
            {/* Enable/Disable Toggle */}
            <Card
              header={
                <div className="flex items-center justify-between mb-4">
                  <h1 className="font-medium text-foreground text-base">
                    Memory
                  </h1>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={memoryEnabled}
                      onCheckedChange={() => toggleMemory()}
                    />
                  </div>
                </div>
              }
            >
              <CardItem
                title="Automatic memory"
                description="When enabled, personal facts shared in conversations are automatically remembered across chats."
                align="start"
              />
            </Card>

            {/* Stored Facts */}
            <Card title={`Stored facts (${memories.length} / ${MEMORY_LIMIT})`}>
              {memories.length === 0 ? (
                <CardItem
                  description="No memories yet. Enable memory and chat — personal facts will be remembered automatically."
                />
              ) : (
                <>
                  {/* Search bar */}
                  <div className="relative mb-3">
                    <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search memories..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                  {searchQuery && (
                    <p className="text-xs text-muted-foreground mb-2">
                      Showing {filteredMemories.length} of {memories.length}
                    </p>
                  )}
                  <div className="max-h-[480px] overflow-y-auto -mx-1 mb-3">
                    {filteredMemories.map((entry) => (
                      <MemoryRow
                        key={entry.id}
                        entry={entry}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                        onNavigateToThread={handleNavigateToThread}
                      />
                    ))}
                    {filteredMemories.length === 0 && searchQuery && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No memories match your search.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-end pt-2 border-t border-border/40">
                    <Button variant="destructive" size="sm" onClick={handleClearAll}>
                      Clear All
                    </Button>
                  </div>
                </>
              )}
            </Card>

            {/* Backup */}
            <Card title="Backup">
              <CardItem
                description="Export your memories as a JSON file or import from a previous backup."
              />
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={memories.length === 0}
                >
                  <IconDownload size={14} className="mr-1.5" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!memoryEnabled}
                >
                  <IconUpload size={14} className="mr-1.5" />
                  Import
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
            </Card>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
