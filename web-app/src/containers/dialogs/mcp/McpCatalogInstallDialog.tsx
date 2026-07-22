import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMCPServers, type MCPServerConfig } from '@/hooks/tools/useMCPServers'
import type { McpCatalogEntry } from '@/schemas/mcp-catalog.schema'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'

interface McpCatalogInstallDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: McpCatalogEntry | null
}

export function McpCatalogInstallDialog({
  open,
  onOpenChange,
  entry,
}: McpCatalogInstallDialogProps) {
  const { t } = useTranslation()
  const addServer = useMCPServers((state) => state.addServer)
  const deleteServer = useMCPServers((state) => state.deleteServer)
  const syncServers = useMCPServers((state) => state.syncServers)
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const isStdio = entry?.transport === 'stdio'
  const fields = useMemo(
    () => [...(entry?.env ?? []), ...(entry?.headers ?? [])],
    [entry]
  )

  useEffect(() => {
    if (open && entry) {
      setEnvValues(
        Object.fromEntries(
          fields
            .filter((field) => field.defaultValue !== undefined)
            .map((field) => [field.key, field.defaultValue as string])
        )
      )
    }
  }, [open, entry, fields])

  const missingRequired = fields.some(
    (field) => field.required && !envValues[field.key]?.trim()
  )

  const handleConfirm = async () => {
    if (!entry || missingRequired) return

    const envRecord = Object.fromEntries(
      (entry.env ?? [])
        .map((field) => [field.key, envValues[field.key]?.trim() ?? ''])
        .filter(([, value]) => value !== '')
    )
    const headersRecord = Object.fromEntries(
      (entry.headers ?? [])
        .map((field) => [field.key, envValues[field.key]?.trim() ?? ''])
        .filter(([, value]) => value !== '')
    )

    // Installed servers stay inactive until the user explicitly enables
    // them in the server list — tool descriptions must not enter the
    // model context before the user opts in.
    const config: MCPServerConfig = isStdio
      ? {
          command: entry.command ?? '',
          args: entry.args ?? [],
          env: envRecord,
          type: 'stdio',
          active: false,
          ...(entry.timeoutSeconds !== undefined && {
            timeout: entry.timeoutSeconds,
          }),
        }
      : {
          command: '',
          args: [],
          env: {},
          type: entry.transport,
          url: entry.url,
          ...(Object.keys(headersRecord).length > 0 && {
            headers: headersRecord,
          }),
          ...(entry.timeoutSeconds !== undefined && {
            timeout: entry.timeoutSeconds,
          }),
          active: false,
        }

    addServer(entry.name, config)
    setSaving(true)
    try {
      await syncServers()
      toast.success(
        t('mcp-servers:catalog.installSuccess', { serverName: entry.name })
      )
      onOpenChange(false)
    } catch (error) {
      // Persistence failed, so restore the in-memory list to match disk.
      deleteServer(entry.name)
      console.error('Failed to install MCP catalog server:', error)
      toast.error(t('mcp-servers:catalog.installFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!entry) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('mcp-servers:catalog.installTitle', { title: entry.title })}
          </DialogTitle>
          <DialogDescription>
            {t('mcp-servers:catalog.installDescription', {
              publisher: entry.publisher,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t('mcp-servers:catalog.warning')}
          </p>

          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {entry.capabilitiesNote}
            </p>
            <a
              href={entry.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline break-all"
            >
              {entry.repoUrl}
            </a>
          </div>

          {isStdio ? (
            <div className="space-y-2">
              <label className="text-[13px] text-muted-foreground inline-block">
                {t('mcp-servers:catalog.commandToRun')}
              </label>
              {/* Full, untruncated command + args — users must be able to
                  review exactly what will run before consenting. */}
              <pre className="font-mono text-xs bg-secondary/60 border border-border/50 rounded-md p-2 overflow-x-auto whitespace-pre">
                {[entry.command, ...(entry.args ?? [])].join(' ')}
              </pre>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-[13px] text-muted-foreground inline-block">
                {t('mcp-servers:catalog.remoteServer')}
              </label>
              <pre className="font-mono text-xs bg-secondary/60 border border-border/50 rounded-md p-2 overflow-x-auto whitespace-pre">
                {entry.url}
              </pre>
              {entry.headers && entry.headers.length > 0 && (
                <p className="text-xs text-muted-foreground break-all">
                  {t('mcp-servers:catalog.headerKeys')}:{' '}
                  {entry.headers.map((field) => field.key).join(', ')}
                </p>
              )}
            </div>
          )}

          {fields.length > 0 && (
            <div className="space-y-3">
              <label className="text-[13px] text-muted-foreground inline-block">
                {t('mcp-servers:envVars')}
              </label>
              {fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{field.key}</span>
                    <span className="text-xs text-muted-foreground">
                      {field.required
                        ? t('mcp-servers:catalog.required')
                        : t('mcp-servers:catalog.optional')}
                      {field.secret && ` · ${t('mcp-servers:catalog.secret')}`}
                    </span>
                  </div>
                  {field.description && (
                    <p className="text-xs text-muted-foreground">
                      {field.description}
                    </p>
                  )}
                  <Input
                    type={field.secret ? 'password' : 'text'}
                    value={envValues[field.key] ?? ''}
                    onChange={(e) =>
                      setEnvValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value,
                      }))
                    }
                    aria-label={field.key}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('common:cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={missingRequired || saving}
          >
            {t('mcp-servers:catalog.confirmInstall')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
