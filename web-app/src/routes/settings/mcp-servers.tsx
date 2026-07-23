import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { HeaderPage } from '@/containers/HeaderPage'
import { SettingsMenu } from '@/components/common/SettingsMenu'
import { Card, CardItem } from '@/components/common/Card'
import { Code, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout'
import {
  DEFAULT_MCP_SETTINGS,
  type MCPServerConfig,
  type MCPSettings,
  useMCPServers,
} from '@/hooks/tools/useMCPServers'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { AddEditMCPServer } from '@/containers/dialogs/mcp/AddEditMCPServer'
import { DeleteMCPServerConfirm } from '@/containers/dialogs/mcp/DeleteMCPServerConfirm'
import { EditJsonMCPserver } from '@/containers/dialogs/mcp/EditJsonMCPserver'
import { McpCatalogSection } from '@/components/settings/McpCatalogSection'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { twMerge } from 'tailwind-merge'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useToolApproval } from '@/hooks/tools/useToolApproval'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/settings/useAppState'
import { listen } from '@tauri-apps/api/event'
import { SystemEvent } from '@/types/events'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isMissingRunningServerError } from '@/lib/mcp/deactivate-errors'

// Descriptions and setup hints for official MCP servers
const OFFICIAL_SERVER_HINTS: Record<
  string,
  { description: string; hint: string; link?: { label: string; url: string } }
> = {
  'ax-studio': {
    description:
      'Knowledge base powered by AkiDB. Provides semantic search, document ingestion, and RAG tools for your local files.',
    hint: 'To use from source, set command to "node" and the first arg to the path of your ax-fabric cli.js, followed by "mcp" and "server".',
    link: {
      label: 'AX Studio Documentation',
      url: 'https://github.com/defai-digital/ax-studio',
    },
  },
}

const MAX_TOOL_CALL_TIMEOUT_SECONDS = 3600

function parseToolCallTimeoutSeconds(rawValue: string): number | null {
  const trimmed = rawValue.trim()
  if (trimmed === '' || !/^\d+$/.test(trimmed)) return null

  const value = Number(trimmed)
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_TOOL_CALL_TIMEOUT_SECONDS
  ) {
    return null
  }

  return value
}

// Function to mask sensitive URL parameters
const maskSensitiveUrl = (url: string) => {
  if (!url) return url

  try {
    const urlObj = new URL(url)
    const params = urlObj.searchParams

    // List of sensitive parameter names (case-insensitive)
    const sensitiveParams = [
      'api_key',
      'apikey',
      'key',
      'token',
      'secret',
      'password',
      'pwd',
      'auth',
      'authorization',
      'bearer',
      'access_token',
      'refresh_token',
      'client_secret',
      'private_key',
      'signature',
      'hash',
    ]

    // Mask sensitive parameters
    sensitiveParams.forEach((paramName) => {
      // Check both exact match and case-insensitive match
      for (const [key] of params.entries()) {
        if (key.toLowerCase() === paramName.toLowerCase()) {
          params.set(key, '******')
        }
      }
    })

    // Reconstruct URL with masked parameters
    urlObj.search = params.toString()
    return urlObj.toString()
  } catch {
    // If URL parsing fails, just mask the entire query string after '?'
    const queryIndex = url.indexOf('?')
    if (queryIndex === -1) return url

    const baseUrl = url.substring(0, queryIndex + 1)
    return baseUrl + '******'
  }
}

export const Route = createFileRoute(route.settings.mcp_servers)({
  component: MCPServersDesktop,
})

function MCPServersDesktop() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const {
    mcpServers,
    settings,
    addServer,
    editServer,
    renameServer,
    deleteServer,
    syncServers,
    syncServersAndRestart,
    getServerConfig,
    setSettings,
    updateSettings,
  } = useMCPServers()
  const { allowAllMCPPermissions, setAllowAllMCPPermissions } =
    useToolApproval()

  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [currentConfig, setCurrentConfig] = useState<
    MCPServerConfig | undefined
  >(undefined)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)

  // JSON editor dialog state
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false)
  const [jsonServerName, setJsonServerName] = useState<string | null>(null)
  const [jsonEditorData, setJsonEditorData] = useState<
    | MCPServerConfig
    | Record<string, MCPServerConfig>
    | {
        mcpServers: Record<string, MCPServerConfig>
        mcpSettings?: MCPSettings
      }
    | undefined
  >(undefined)
  const [connectedServers, setConnectedServers] = useState<string[]>([])
  const [loadingServers, setLoadingServers] = useState<{
    [key: string]: boolean
  }>({})
  const isAnyServerLoading = Object.values(loadingServers).some(Boolean)
  const isMountedRef = useRef(true)
  const setErrorMessage = useAppState((state) => state.setErrorMessage)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  const refreshConnectedServers = useCallback(
    async (shouldIgnoreResult?: () => boolean) => {
      try {
        const servers = await serviceHub.mcp().getConnectedServers()
        if (isMountedRef.current && !shouldIgnoreResult?.()) {
          setConnectedServers(servers)
        }
      } catch (error) {
        if (isMountedRef.current && !shouldIgnoreResult?.()) {
          console.error(error)
        }
      }
    },
    [serviceHub]
  )

  const updateToolCallTimeout = (rawValue: string) => {
    if (rawValue === '') {
      updateSettings({
        toolCallTimeoutSeconds: DEFAULT_MCP_SETTINGS.toolCallTimeoutSeconds,
      })
      return
    }

    const numericValue = parseToolCallTimeoutSeconds(rawValue)
    if (numericValue === null) return

    updateSettings({ toolCallTimeoutSeconds: numericValue })
  }

  const handleOpenDialog = (serverKey?: string) => {
    if (serverKey) {
      // Edit mode
      setCurrentConfig(mcpServers[serverKey])
      setEditingKey(serverKey)
    } else {
      // Add mode
      setCurrentConfig(undefined)
      setEditingKey(null)
    }
    setOpen(true)
  }

  const handleSaveServer = async (
    name: string,
    config: MCPServerConfig
  ): Promise<boolean> => {
    if (editingKey) {
      // If server name changed, rename it while preserving position
      if (editingKey !== name) {
        if (getServerConfig(name)) {
          toast.error(`An MCP server named "${name}" already exists`)
          return false
        }
        const originalConfig = getServerConfig(editingKey)
        if (!originalConfig) return false
        const shouldBeActive = config.active ?? originalConfig.active ?? false
        if (!(await toggleServer(editingKey, false))) return false
        renameServer(editingKey, name, {
          ...config,
          active: false,
        })
        if (shouldBeActive && !(await toggleServer(name, true))) {
          // Keep the original key usable when the renamed server cannot start.
          renameServer(name, editingKey, {
            ...originalConfig,
            active: false,
          })
          if (originalConfig.active) await toggleServer(editingKey, true)
          return false
        }
        // Restart servers to update tool references with new server name
        return syncEditedServersAndRestart()
      } else {
        const originalConfig = getServerConfig(editingKey)
        if (!originalConfig) return false
        const shouldBeActive = config.active ?? originalConfig.active ?? false
        if (!(await toggleServer(editingKey, false))) return false
        editServer(editingKey, { ...config, active: false })
        return shouldBeActive
          ? toggleServer(editingKey, true)
          : syncEditedServers()
      }
    } else {
      // Add new server
      const shouldBeActive = config.active ?? true
      addServer(name, { ...config, active: false })
      return shouldBeActive ? toggleServer(name, true) : syncEditedServers()
    }
  }

  const handleEdit = (serverKey: string) => {
    handleOpenDialog(serverKey)
  }

  const handleDeleteClick = (serverKey: string) => {
    setServerToDelete(serverKey)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async (): Promise<boolean> => {
    if (!serverToDelete) return false
    // Stop the server before deletion
    if (!(await toggleServer(serverToDelete, false))) return false

    deleteServer(serverToDelete)
    toast.success(
      t('mcp-servers:deleteServer.success', { serverName: serverToDelete })
    )
    const synced = await syncEditedServersAndRestart()
    if (synced) setServerToDelete(null)
    return synced
  }

  const handleOpenJsonEditor = async (serverKey?: string) => {
    if (serverKey) {
      // Edit single server JSON
      setJsonServerName(serverKey)
      setJsonEditorData(mcpServers[serverKey])
    } else {
      // Edit all servers JSON
      setJsonServerName(null)
      setJsonEditorData({
        mcpServers,
        mcpSettings: settings,
      })
    }
    setJsonEditorOpen(true)
  }

  const syncEditedServers = async (): Promise<boolean> => {
    try {
      await syncServers()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Failed to save MCP server configuration:', error)
      setErrorMessage({
        message,
        subtitle: t('mcp-servers:checkParams'),
      })
      toast.error('Failed to save MCP server configuration', {
        description:
          message.length > 300 ? `${message.slice(0, 300)}...` : message,
      })
      return false
    }
  }

  const syncEditedServersAndRestart = async (): Promise<boolean> => {
    try {
      await syncServersAndRestart()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Failed to save and restart MCP servers:', error)
      setErrorMessage({
        message,
        subtitle: t('mcp-servers:checkParams'),
      })
      toast.error('Failed to restart MCP servers', {
        description:
          message.length > 300 ? `${message.slice(0, 300)}...` : message,
      })
      return false
    }
  }

  const handleSaveJson = async (
    data:
      | MCPServerConfig
      | Record<string, MCPServerConfig>
      | {
          mcpServers?: Record<string, MCPServerConfig>
          mcpSettings?: MCPSettings
        }
  ): Promise<boolean> => {
    if (jsonServerName) {
      if (!(await toggleServer(jsonServerName, false))) return false
      // Save single server
      const config = data as MCPServerConfig
      const shouldBeActive = config.active ?? false
      editServer(jsonServerName, { ...config, active: shouldBeActive })
      if (shouldBeActive) return toggleServer(jsonServerName, true)
      return syncEditedServers()
    } else {
      // Save all servers
      let nextServers: Record<string, MCPServerConfig> = {}
      let nextSettings: MCPSettings | undefined

      if (data && typeof data === 'object' && !Array.isArray(data)) {
        if ('mcpServers' in data || 'mcpSettings' in data) {
          const payload = data as {
            mcpServers?: Record<string, MCPServerConfig>
            mcpSettings?: MCPSettings
          }
          nextServers = payload.mcpServers ?? {}
          nextSettings = payload.mcpSettings
        } else {
          nextServers = data as Record<string, MCPServerConfig>
        }
      }

      // Capture original active states before clearing
      const originalActiveStates = Object.fromEntries(
        Object.entries(mcpServers).map(([key, config]) => [
          key,
          config.active ?? false,
        ])
      )

      // Stop every existing server before replacing any configuration. If one
      // stop fails, restore servers already stopped and leave the JSON edit
      // unapplied rather than overwriting a backend process that is still live.
      const stoppedActiveServerKeys: string[] = []
      for (const [serverKey, config] of Object.entries(mcpServers)) {
        if (!(await toggleServer(serverKey, false))) {
          for (const stoppedKey of stoppedActiveServerKeys.reverse()) {
            await toggleServer(stoppedKey, true)
          }
          return false
        }
        if (config.active) stoppedActiveServerKeys.push(serverKey)
      }

      // All old processes are stopped, so their configurations can now be
      // removed without leaving an unreachable live server behind.
      for (const serverKey of Object.keys(mcpServers)) {
        deleteServer(serverKey)
      }

      if (nextSettings) {
        setSettings({
          ...DEFAULT_MCP_SETTINGS,
          ...nextSettings,
        })
      }

      // Add all servers from the JSON, preserving original active state
      // unless the user explicitly changed it in the JSON editor
      let allServersStarted = true
      for (const [key, config] of Object.entries(nextServers)) {
        const wasActive = Object.prototype.hasOwnProperty.call(
          originalActiveStates,
          key
        )
          ? originalActiveStates[key]
          : false
        const userSetActive = config.active ?? wasActive
        addServer(key, { ...config, active: userSetActive })
        if (userSetActive && !(await toggleServer(key, true))) {
          allServersStarted = false
        }
      }

      const synced = await syncEditedServers()
      return allServersStarted && synced
    }
  }

  const toggleServer = async (
    serverKey: string,
    active: boolean
  ): Promise<boolean> => {
    if (!serverKey) return false

    const config = getServerConfig(serverKey)
    if (!config) {
      console.error(
        `Cannot ${active ? 'start' : 'stop'} unknown MCP server "${serverKey}"`
      )
      return false
    }

    setLoadingServers((prev) => ({ ...prev, [serverKey]: true }))
    let backendActivated = false
    try {
      if (active) {
        await serviceHub.mcp().activateMCPServer(serverKey, {
          ...config,
          active: true,
        })
        backendActivated = true
        editServer(serverKey, { ...config, active: true })
        await syncServers()
      } else {
        editServer(serverKey, { ...config, active: false })
        await syncServers()
        // Inactive configurations have no running backend entry; asking Rust
        // to deactivate one returns "Server not found" and must not block
        // editing or deleting that configuration.
        if (config.active) {
          try {
            await serviceHub.mcp().deactivateMCPServer(serverKey)
          } catch (error) {
            if (!isMissingRunningServerError(error)) {
              throw error
            }
            console.info(
              `MCP server "${serverKey}" was already stopped while disabling it.`
            )
          }
        }
      }

      toast.success(
        active
          ? t('mcp-servers:serverStatusActive', { serverKey })
          : t('mcp-servers:serverStatusInactive', { serverKey })
      )
      await refreshConnectedServers()
      return true
    } catch (error) {
      // Keep the persisted switch state aligned with the backend when a
      // transition fails. In particular, a failed stop must remain active.
      if (active && backendActivated) {
        try {
          await serviceHub.mcp().deactivateMCPServer(serverKey)
        } catch (rollbackError) {
          console.error(
            'Failed to stop MCP server during rollback:',
            rollbackError
          )
        }
      }
      editServer(serverKey, {
        ...config,
        active: active ? false : (config.active ?? false),
      })
      try {
        await syncServers()
      } catch (syncError) {
        console.error('Failed to roll back MCP server state:', syncError)
      }
      const errMsg =
        typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : String(error)
      setErrorMessage({
        message: errMsg,
        subtitle: t('mcp-servers:checkParams'),
      })
      toast.error(
        `Failed to ${active ? 'start' : 'stop'} MCP server "${serverKey}"`,
        {
          description:
            errMsg.length > 300 ? errMsg.slice(0, 300) + '...' : errMsg,
        }
      )
      return false
    } finally {
      if (isMountedRef.current) {
        setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
      }
    }
  }

  useEffect(() => {
    let isActive = true
    let unlisten: (() => void) | undefined
    const shouldIgnoreResult = () => !isActive

    void refreshConnectedServers(shouldIgnoreResult)

    const setupListener = async () => {
      try {
        const nextUnlisten = await listen(SystemEvent.MCP_UPDATE, () => {
          if (isActive) {
            void refreshConnectedServers(shouldIgnoreResult)
          }
        })

        if (!isActive) {
          nextUnlisten()
          return
        }

        unlisten = nextUnlisten
      } catch (error) {
        if (isActive) {
          console.error(error)
        }
      }
    }

    void setupListener()

    return () => {
      isActive = false
      try {
        unlisten?.()
      } catch (error) {
        console.error('Failed to remove MCP update listener:', error)
      }
    }
  }, [refreshConnectedServers])

  return (
    <Fragment>
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <div
            className={cn(
              'flex items-center justify-between w-full mr-2 pr-3',
              !IS_MACOS && 'pr-30'
            )}
          >
            <span className="font-medium text-base font-studio">
              {t('common:settings')}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={isAnyServerLoading}
              onClick={() => handleOpenDialog()}
              className="relative z-50"
            >
              <Plus size={18} className="text-muted-foreground" />
              {t('mcp-servers:addServer')}
            </Button>
          </div>
        </HeaderPage>
        <div className="flex flex-1 min-h-0">
          <SettingsMenu />
          <div
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            <SettingsPageLayout icon={Wrench} title={t('common:mcp-servers')} />
            <div className="px-8 py-7">
              <div className="max-w-2xl space-y-6">
                <McpCatalogSection />
                <Card
                  header={
                    <div className="flex flex-col mb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h1 className="text-foreground font-medium text-base font-studio">
                            {t('mcp-servers:title')}
                          </h1>
                          <div className="text-xs bg-secondary border text-muted-foreground rounded-full py-0.5 px-2">
                            <span>{t('mcp-servers:experimental')}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5">
                          <Button
                            onClick={() => handleOpenJsonEditor()}
                            title={t('mcp-servers:editAllJson')}
                            aria-label={t('mcp-servers:editAllJson')}
                            size="icon-xs"
                            variant="ghost"
                            disabled={isAnyServerLoading}
                          >
                            <Code size={18} className="text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-sm mt-1">
                        {t('mcp-servers:findMore')}{' '}
                        <a
                          href="https://mcp.so/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          mcp.so
                        </a>
                      </p>
                    </div>
                  }
                >
                  <CardItem
                    title={t('mcp-servers:allowPermissions')}
                    description={t('mcp-servers:allowPermissionsDesc')}
                    actions={
                      <div className="shrink-0 ml-4">
                        <Switch
                          checked={allowAllMCPPermissions}
                          onCheckedChange={setAllowAllMCPPermissions}
                        />
                      </div>
                    }
                  />
                  <CardItem
                    title={t('mcp-servers:runtimeSettings.toolCallTimeout')}
                    description={t(
                      'mcp-servers:runtimeSettings.toolCallTimeoutDesc'
                    )}
                    actions={
                      <Input
                        type="number"
                        min={1}
                        max={MAX_TOOL_CALL_TIMEOUT_SECONDS}
                        step={1}
                        value={settings.toolCallTimeoutSeconds}
                        onChange={(event) =>
                          updateToolCallTimeout(event.target.value)
                        }
                        onBlur={() => {
                          void syncEditedServers()
                        }}
                        className="w-28"
                      />
                    }
                  />
                </Card>

                {Object.keys(mcpServers).length === 0 ? (
                  <div className="py-4 text-center font-medium text-muted-foreground">
                    {t('mcp-servers:noServers')}
                  </div>
                ) : (
                  Object.entries(mcpServers).map(([key, config], index) => (
                    <Card key={`${key}-${index}`}>
                      <CardItem
                        align="start"
                        title={
                          <div className="flex items-center gap-x-2">
                            <div
                              className={twMerge(
                                'size-2 rounded-full',
                                connectedServers.includes(key)
                                  ? 'bg-green-600 dark:bg-green-600'
                                  : 'bg-secondary'
                              )}
                            />
                            <h1 className="text-foreground text-base capitalize font-studio">
                              {key}
                            </h1>
                            {config.official && (
                              <div className="flex items-center gap-1.5 px-2 py-0.5 text-xs bg-secondary border rounded-sm">
                                <img
                                  src="/images/ax-studio-logo.png"
                                  alt="AX Studio"
                                  className="w-3 h-3 object-contain"
                                />
                                <span>Official</span>
                              </div>
                            )}
                          </div>
                        }
                        descriptionOutside={
                          <div className="text-sm text-muted-foreground">
                            <div className="mb-1">
                              Transport:{' '}
                              <span className="uppercase">
                                {config.type || 'stdio'}
                              </span>
                            </div>

                            {config.type === 'stdio' || !config.type ? (
                              <>
                                <div>
                                  {t('mcp-servers:command')}: {config.command}
                                </div>
                                <div className="my-1 break-all">
                                  {t('mcp-servers:args')}:{' '}
                                  {config?.args?.join(', ')}
                                </div>
                                {config.env &&
                                  Object.keys(config.env).length > 0 && (
                                    <div className="break-all">
                                      {t('mcp-servers:env')}:{' '}
                                      {Object.entries(config.env)
                                        .map(([key]) => `${key}=******`)
                                        .join(', ')}
                                    </div>
                                  )}
                                {OFFICIAL_SERVER_HINTS[key] && (
                                  <div className="mt-2 text-xs text-muted-foreground border-t border-border/40 pt-2">
                                    <p className="mb-1">
                                      {OFFICIAL_SERVER_HINTS[key].description}
                                    </p>
                                    <p className="mb-1 text-amber-500/80">
                                      {OFFICIAL_SERVER_HINTS[key].hint}
                                    </p>
                                    {OFFICIAL_SERVER_HINTS[key].link && (
                                      <a
                                        href={
                                          OFFICIAL_SERVER_HINTS[key].link!.url
                                        }
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:underline"
                                      >
                                        {OFFICIAL_SERVER_HINTS[key].link!.label}{' '}
                                        →
                                      </a>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="break-all">
                                  URL: {maskSensitiveUrl(config.url || '')}
                                </div>
                                {config.headers &&
                                  Object.keys(config.headers).length > 0 && (
                                    <div className="my-1 break-all">
                                      Headers:{' '}
                                      {Object.entries(config.headers)
                                        .map(([key]) => `${key}=******`)
                                        .join(', ')}
                                    </div>
                                  )}
                                {config.timeout && (
                                  <div>Timeout: {config.timeout}s</div>
                                )}
                              </>
                            )}
                          </div>
                        }
                        actions={
                          <div className="flex items-center gap-0.5">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={!!loadingServers[key]}
                              onClick={() => handleOpenJsonEditor(key)}
                              title={t('mcp-servers:editJson.title', {
                                serverName: key,
                              })}
                              aria-label={t('mcp-servers:editJson.title', {
                                serverName: key,
                              })}
                            >
                              <Code
                                size={18}
                                className="text-muted-foreground"
                              />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={!!loadingServers[key]}
                              onClick={() => handleEdit(key)}
                              title={t('mcp-servers:editServer')}
                              aria-label={t('mcp-servers:editServer')}
                            >
                              <Pencil
                                size={18}
                                className="text-muted-foreground"
                              />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              disabled={!!loadingServers[key]}
                              onClick={() => handleDeleteClick(key)}
                              title={t('mcp-servers:deleteServer.title')}
                              aria-label={t('mcp-servers:deleteServer.title')}
                            >
                              <Trash2
                                size={18}
                                className="text-muted-foreground"
                              />
                            </Button>
                            <div className="ml-2">
                              <Switch
                                checked={config.active}
                                disabled={!!loadingServers[key]}
                                loading={!!loadingServers[key]}
                                onCheckedChange={(checked) =>
                                  void toggleServer(key, checked)
                                }
                              />
                            </div>
                          </div>
                        }
                      />
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Use the AddEditMCPServer component */}
      <AddEditMCPServer
        open={open}
        onOpenChange={setOpen}
        editingKey={editingKey}
        initialData={currentConfig}
        onSave={handleSaveServer}
      />

      {/* Delete confirmation dialog */}
      <DeleteMCPServerConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        serverName={serverToDelete || ''}
        onConfirm={handleConfirmDelete}
      />

      {/* JSON editor dialog */}
      <EditJsonMCPserver
        open={jsonEditorOpen}
        onOpenChange={setJsonEditorOpen}
        serverName={jsonServerName}
        initialData={
          jsonEditorData ?? {
            mcpServers,
            mcpSettings: settings,
          }
        }
        onSave={handleSaveJson}
      />
    </Fragment>
  )
}
