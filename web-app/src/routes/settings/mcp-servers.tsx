import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/components/common/SettingsMenu'
import { Card, CardItem } from '@/components/common/Card'
import { Code, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import {
  useMCPServers,
  MCPServerConfig,
  MCPSettings,
  DEFAULT_MCP_SETTINGS,
} from '@/hooks/tools/useMCPServers'
import { Fragment, useEffect, useState } from 'react'
import AddEditMCPServer from '@/containers/dialogs/mcp/AddEditMCPServer'
import DeleteMCPServerConfirm from '@/containers/dialogs/mcp/DeleteMCPServerConfirm'
import EditJsonMCPserver from '@/containers/dialogs/mcp/EditJsonMCPserver'
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

// Descriptions and setup hints for official MCP servers
const OFFICIAL_SERVER_HINTS: Record<
  string,
  { description: string; hint: string; link?: { label: string; url: string } }
> = {
  'ax-studio': {
    description:
      'Knowledge base powered by AkiDB. Provides semantic search, document ingestion, and RAG tools for your local files.',
    hint: 'To use from source: set command to "node" and first arg to the path of your ax-studio cli.js, followed by "mcp" and "server". If installed via npm: set command to "npx" with args "-y @ax-studio/fabric-ingest mcp server".',
    link: {
      label: 'AX Studio Documentation',
      url: 'https://github.com/defai-digital/ax-studio',
    },
  },
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
  const setErrorMessage = useAppState((state) => state.setErrorMessage)

  const updateToolCallTimeout = (rawValue: string) => {
    if (rawValue === '') {
      updateSettings({
        toolCallTimeoutSeconds: DEFAULT_MCP_SETTINGS.toolCallTimeoutSeconds,
      })
      return
    }

    const numericValue = Number(rawValue)
    if (!Number.isNaN(numericValue)) {
      updateSettings({ toolCallTimeoutSeconds: numericValue })
    }
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

  const handleSaveServer = async (name: string, config: MCPServerConfig) => {
    if (editingKey) {
      // If server name changed, rename it while preserving position
      if (editingKey !== name) {
        toggleServer(editingKey, false)
        renameServer(editingKey, name, config)
        toggleServer(name, true)
        // Restart servers to update tool references with new server name
        syncServersAndRestart()
      } else {
        toggleServer(editingKey, false)
        editServer(editingKey, config)
        toggleServer(editingKey, true)
        syncServers()
      }
    } else {
      // Add new server
      toggleServer(name, false)
      addServer(name, config)
      toggleServer(name, true)
      syncServers()
    }
  }

  const handleEdit = (serverKey: string) => {
    handleOpenDialog(serverKey)
  }

  const handleDeleteClick = (serverKey: string) => {
    setServerToDelete(serverKey)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (serverToDelete) {
      // Stop the server before deletion
      try {
        await serviceHub.mcp().deactivateMCPServer(serverToDelete)
      } catch (error) {
        console.error('Error stopping server before deletion:', error)
      }

      deleteServer(serverToDelete)
      toast.success(
        t('mcp-servers:deleteServer.success', { serverName: serverToDelete })
      )
      setServerToDelete(null)
      syncServersAndRestart()
    }
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

  const handleSaveJson = async (
    data:
      | MCPServerConfig
      | Record<string, MCPServerConfig>
      | {
          mcpServers?: Record<string, MCPServerConfig>
          mcpSettings?: MCPSettings
        }
  ) => {
    if (jsonServerName) {
      try {
        toggleServer(jsonServerName, false)
      } catch (error) {
        console.error('Error deactivating server:', error)
      }
      // Save single server
      editServer(jsonServerName, data as MCPServerConfig)
      toggleServer(jsonServerName, (data as MCPServerConfig).active || false)
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

      if (nextSettings) {
        setSettings({
          ...DEFAULT_MCP_SETTINGS,
          ...nextSettings,
        })
      }

      // Clear existing servers first
      Object.keys(mcpServers).forEach((serverKey) => {
        toggleServer(serverKey, false)
        deleteServer(serverKey)
      })

      // Add all servers from the JSON
      Object.entries(nextServers).forEach(([key, config]) => {
        addServer(key, config)
        toggleServer(key, config.active || false)
      })

      await syncServers()
    }
  }

  const toggleServer = (serverKey: string, active: boolean) => {
    if (serverKey) {
      setLoadingServers((prev) => ({ ...prev, [serverKey]: true }))
      const config = getServerConfig(serverKey)
      if (active && config) {
        serviceHub
          .mcp()
          .activateMCPServer(serverKey, {
            ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
            active,
          })
          .then(() => {
            // Save single server
            editServer(serverKey, {
              ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
              active,
            })
            syncServers()
            toast.success(
              active
                ? t('mcp-servers:serverStatusActive', { serverKey })
                : t('mcp-servers:serverStatusInactive', { serverKey })
            )
            serviceHub.mcp().getConnectedServers().then(setConnectedServers).catch(console.error).catch(console.error)
          })
          .catch((error) => {
            editServer(serverKey, {
              ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
              active: false,
            })
            setErrorMessage({
              message: error,
              subtitle: t('mcp-servers:checkParams'),
            })
            // Show a user-visible toast so the error isn't silently swallowed
            const errMsg =
              typeof error === 'string'
                ? error
                : error instanceof Error
                  ? error.message
                  : String(error)
            toast.error(`Failed to start MCP server "${serverKey}"`, {
              description:
                errMsg.length > 300 ? errMsg.slice(0, 300) + '...' : errMsg,
            })
          })
          .finally(() => {
            setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
          })
      } else {
        editServer(serverKey, {
          ...(config ?? (mcpServers[serverKey] as MCPServerConfig)),
          active,
        })
        syncServers()
        serviceHub
          .mcp()
          .deactivateMCPServer(serverKey)
          .finally(() => {
            serviceHub.mcp().getConnectedServers().then(setConnectedServers).catch(console.error)
            setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
          })
      }
    }
  }

  useEffect(() => {
    serviceHub.mcp().getConnectedServers().then(setConnectedServers).catch(console.error)

    let unlisten: (() => void) | undefined
    const setupListener = async () => {
      unlisten = await listen(SystemEvent.MCP_UPDATE, () => {
        serviceHub.mcp().getConnectedServers().then(setConnectedServers).catch(console.error)
      })
    }
    setupListener()

    return () => {
      unlisten?.()
    }
  }, [serviceHub, setConnectedServers])

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
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
              <div
                className="size-7 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                }}
              >
                <Wrench className="size-3.5 text-white" strokeWidth={2.5} />
              </div>
              <h1
                className="text-foreground tracking-tight"
                style={{ fontSize: '16px', fontWeight: 600 }}
              >
                {t('common:mcp-servers')}
              </h1>
            </div>
            <div className="px-8 py-7">
              <div className="max-w-2xl space-y-6">
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
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Code
                              size={18}
                              className="text-muted-foreground"
                            />
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
                        step={1}
                        value={settings.toolCallTimeoutSeconds}
                        onChange={(event) =>
                          updateToolCallTimeout(event.target.value)
                        }
                        onBlur={() => {
                          void syncServers()
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
                                  alt="Ax-Studio"
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
                              onClick={() => handleOpenJsonEditor(key)}
                              title={t('mcp-servers:editJson.title', {
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
                              onClick={() => handleEdit(key)}
                              title={t('mcp-servers:editServer')}
                            >
                              <Pencil
                                size={18}
                                className="text-muted-foreground"
                              />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => handleDeleteClick(key)}
                              title={t('mcp-servers:deleteServer.title')}
                            >
                              <Trash2
                                size={18}
                                className="text-muted-foreground"
                              />
                            </Button>
                            <div className="ml-2">
                              <Switch
                                checked={config.active}
                                loading={!!loadingServers[key]}
                                onCheckedChange={(checked) =>
                                  toggleServer(key, checked)
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
