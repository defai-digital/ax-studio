import { useCallback, useEffect, useState } from 'react'
import { Cpu, Link2, RefreshCw, ShieldCheck, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardItem } from '@/components/common/Card'
import { SettingsMenu } from '@/components/common/SettingsMenu'
import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AX_ENGINE_PROVIDER_ID,
  AX_ENGINE_SIDECAR_DEFAULT_API_KEY,
  AX_ENGINE_SIDECAR_DEFAULT_BASE_URL,
} from '@/constants/providers'
import { HeaderPage } from '@/containers/HeaderPage'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  axEngineEndpointsMayAlias,
  clearAxEngineAttachApiKey,
  getAxEngineConnectionMode,
  normalizeAxEngineAttachBaseURL,
  probeAxEngineConnection,
  readAxEngineAttachApiKey,
  storeAxEngineAttachApiKey,
  type AxEngineConnectionProbe,
} from '@/lib/ax-engine/connection'
import { getModelCapabilities } from '@/lib/models'
import { invoke } from '@/lib/tauri-shim/api-core'
import { cn } from '@/lib/utils'

type ManagedStatus = {
  phase?: string
  baseURL?: string | null
  models?: string[]
  version?: string | null
  detail?: string
}

function mergeAttachedModels(
  provider: ModelProvider,
  modelIds: string[]
): Model[] {
  const existing = new Map(provider.models.map((model) => [model.id, model]))
  return modelIds.map(
    (id) =>
      existing.get(id) ?? {
        id,
        model: id,
        name: id,
        version: '1.0',
        capabilities: getModelCapabilities(AX_ENGINE_PROVIDER_ID, id),
      }
  )
}

export function AxEngineConnectionSettings() {
  const { t } = useTranslation()
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(AX_ENGINE_PROVIDER_ID)
  const mode = getAxEngineConnectionMode(provider)
  const [editingMode, setEditingMode] = useState(mode)
  const [baseURL, setBaseURL] = useState(
    provider?.base_url ?? AX_ENGINE_SIDECAR_DEFAULT_BASE_URL
  )
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [managedStatus, setManagedStatus] = useState<ManagedStatus | null>(null)
  const [attachedStatus, setAttachedStatus] =
    useState<AxEngineConnectionProbe | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  useEffect(() => {
    setEditingMode(mode)
    if (provider?.base_url) setBaseURL(provider.base_url)
  }, [mode, provider?.base_url])

  const refreshStatus = useCallback(async () => {
    setStatusError(null)
    try {
      if (mode === 'attach') {
        const probe = await probeAxEngineConnection({
          baseURL: provider?.base_url,
        })
        setAttachedStatus(probe)
        setManagedStatus(null)
        return
      }
      const status = await invoke<ManagedStatus>('ax_engine_status')
      setManagedStatus(status)
      setAttachedStatus(null)
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }, [mode, provider?.base_url])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const switchToManaged = async () => {
    if (!provider) return
    setBusy(true)
    try {
      await clearAxEngineAttachApiKey()
      updateProvider(AX_ENGINE_PROVIDER_ID, {
        connection_mode: 'managed',
        base_url: AX_ENGINE_SIDECAR_DEFAULT_BASE_URL,
        api_key: AX_ENGINE_SIDECAR_DEFAULT_API_KEY,
        models: [],
      })
      setApiKey('')
      setEditingMode('managed')
      setAttachedStatus(null)
      toast.success('AX Engine will start automatically when a model is used.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to switch AX Engine to managed mode.'
      )
    } finally {
      setBusy(false)
    }
  }

  const connectExisting = async () => {
    if (!provider) return
    setBusy(true)
    try {
      const requestedBaseURL = normalizeAxEngineAttachBaseURL(baseURL)
      const ownedStatus =
        mode === 'managed'
          ? await invoke<ManagedStatus>('ax_engine_status').catch(() => null)
          : null
      if (
        ownedStatus?.baseURL &&
        axEngineEndpointsMayAlias(ownedStatus.baseURL, requestedBaseURL)
      ) {
        throw new Error(
          'AX Studio currently owns the server at this endpoint. Keep Managed mode or attach to a different AX Engine server.'
        )
      }
      const savedKey = await readAxEngineAttachApiKey()
      const effectiveKey =
        apiKey.trim() || savedKey || AX_ENGINE_SIDECAR_DEFAULT_API_KEY
      const connection = await probeAxEngineConnection({
        baseURL: requestedBaseURL,
        apiKey: effectiveKey,
      })
      await storeAxEngineAttachApiKey(effectiveKey)
      if (ownedStatus?.baseURL) {
        await invoke('ax_engine_stop').catch(() => undefined)
      }
      updateProvider(AX_ENGINE_PROVIDER_ID, {
        connection_mode: 'attach',
        base_url: connection.baseURL,
        // Never persist the external bearer token in Zustand/localStorage.
        api_key: '',
        models: mergeAttachedModels(provider, connection.models),
      })
      setBaseURL(connection.baseURL)
      setApiKey('')
      setEditingMode('attach')
      setAttachedStatus(connection)
      setManagedStatus(null)
      setStatusError(null)
      toast.success(`Connected to AX Engine at ${connection.baseURL}.`)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to connect to AX Engine.'
      )
    } finally {
      setBusy(false)
    }
  }

  const stopManaged = async () => {
    setBusy(true)
    try {
      await invoke('ax_engine_stop')
      await refreshStatus()
      toast.success('AX Engine stopped.')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to stop AX Engine.'
      )
    } finally {
      setBusy(false)
    }
  }

  const statusText =
    mode === 'attach'
      ? attachedStatus
        ? `Connected · ${attachedStatus.models.length} model${
            attachedStatus.models.length === 1 ? '' : 's'
          }`
        : statusError || 'Checking attached server…'
      : managedStatus?.phase === 'ready'
        ? `Ready · ${managedStatus.models?.join(', ') || managedStatus.baseURL}`
        : managedStatus?.detail ||
          statusError ||
          'Starts automatically when a local model is used.'

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage>
        <div className="flex w-full items-center gap-2">
          <span className="font-studio text-base font-medium">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex min-h-0 flex-1">
        <SettingsMenu />
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'thin' }}
        >
          <SettingsPageLayout
            icon={Cpu}
            title="AX Engine"
            subtitle="Run local models automatically or connect to an AX Engine server you already manage."
          />
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-5">
              <Card title="Connection mode">
                <CardItem
                  title="Managed local"
                  description="Recommended. AX Studio starts AX Engine automatically when you use a downloaded model and stops only processes it owns."
                  actions={
                    <Button
                      size="sm"
                      variant={
                        editingMode === 'managed' ? 'default' : 'outline'
                      }
                      disabled={busy}
                      onClick={() => {
                        setEditingMode('managed')
                        if (mode !== 'managed') void switchToManaged()
                      }}
                    >
                      Managed
                    </Button>
                  }
                />
                <CardItem
                  title="Existing server"
                  description="Advanced. Connect to a local AX Engine server without starting or stopping that external process."
                  actions={
                    <Button
                      size="sm"
                      variant={editingMode === 'attach' ? 'default' : 'outline'}
                      disabled={busy}
                      onClick={() => setEditingMode('attach')}
                    >
                      Attach
                    </Button>
                  }
                />
              </Card>

              {editingMode === 'attach' && (
                <Card title="Existing server">
                  <div className="space-y-4 px-5 py-4">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium">Endpoint</span>
                      <Input
                        value={baseURL}
                        onChange={(event) => setBaseURL(event.target.value)}
                        placeholder={AX_ENGINE_SIDECAR_DEFAULT_BASE_URL}
                        spellCheck={false}
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium">API key</span>
                      <Input
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={
                          mode === 'attach' ? 'Saved securely' : 'local'
                        }
                      />
                      <span className="block text-[11px] leading-relaxed text-muted-foreground">
                        Leave blank to keep the saved key, or use the local
                        default on first connection.
                      </span>
                    </label>
                    <Button
                      size="sm"
                      disabled={busy || !baseURL.trim()}
                      onClick={() => void connectExisting()}
                    >
                      <Link2 className="size-4" />
                      {busy
                        ? 'Checking…'
                        : mode === 'attach'
                          ? 'Update connection'
                          : 'Connect'}
                    </Button>
                  </div>
                </Card>
              )}

              <Card title="Status">
                <CardItem
                  title={
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'size-2 rounded-full',
                          (mode === 'attach' && attachedStatus) ||
                            managedStatus?.phase === 'ready'
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/50'
                        )}
                      />
                      {mode === 'attach'
                        ? 'Attached server'
                        : 'Managed runtime'}
                    </span>
                  }
                  description={statusText}
                  actions={
                    <div className="flex items-center gap-2">
                      {mode === 'managed' &&
                        managedStatus?.phase === 'ready' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void stopManaged()}
                          >
                            <Square className="size-3.5" />
                            Stop
                          </Button>
                        )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void refreshStatus()}
                      >
                        <RefreshCw
                          className={cn('size-3.5', busy && 'animate-spin')}
                        />
                        Refresh
                      </Button>
                    </div>
                  }
                />
              </Card>

              <div className="flex items-start gap-3 rounded-xl border border-border/50 bg-card p-4">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Attached-server credentials are stored by the desktop secure
                  credential service. AX Studio validates the endpoint, model
                  cards, authentication, and tool-calling support before saving.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
