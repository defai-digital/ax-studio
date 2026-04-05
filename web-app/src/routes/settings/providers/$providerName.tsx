import { Card, CardItem } from '@/components/common/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/components/common/SettingsMenu'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { cn, getProviderTitle, getProviderColor, getModelDisplayName } from '@/lib/utils'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/components/common/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/model/EditModel'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/model/DeleteModel'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import {
  IconLoader,
} from '@tabler/icons-react'
import { RefreshCw, Search, Plug, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useCallback, useEffect, useRef, useState } from 'react'
import { predefinedProviders } from '@/constants/providers'
import { DialogAddModel } from '@/containers/dialogs/model/AddModel'
import { SelectModelGroups } from '@/containers/dialogs/model/SelectModelGroups'
import { groupModelsByPrefix, type ModelGroup } from '@/lib/model-group-utils'
import { getModelCapabilities } from '@/lib/models'
import ProvidersAvatar from '@/components/common/ProvidersAvatar'

const URL_REGEX = /^https?:\/\/[^\s]+$/
const XSS_PATTERN = /<[^>]*>|javascript:/i

function validateSettingValue(
  key: string,
  value: string | boolean | number
): string | null {
  if (typeof value !== 'string') return null

  if (key === 'api-key') {
    if (value && /^\s|\s$/.test(value)) {
      return 'API key must not contain leading or trailing whitespace.'
    }
    if (value && XSS_PATTERN.test(value)) {
      return 'API key contains invalid characters.'
    }
  }

  if (key === 'base-url') {
    if (value && !URL_REGEX.test(value)) {
      return 'Base URL must be a valid URL starting with http:// or https://'
    }
  }

  return null
}

// as route.threadsDetail
export const Route = createFileRoute('/settings/providers/$providerName')({
  component: ProviderDetail,
  validateSearch: (search: Record<string, unknown>): { step?: string } => {
    // validate and parse the search params into a typed state
    return {
      step: String(search?.step),
    }
  },
})

function ProviderDetail() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [importingModel, setImportingModel] = useState<string | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [pendingGroups, setPendingGroups] = useState<ModelGroup[] | null>(null)
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const providerColor = getProviderColor(providerName)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [connectionMessage, setConnectionMessage] = useState('')
  const lastValidValues = useRef<Record<string, string>>({})

  useEffect(() => {
    if (provider?.settings) {
      provider.settings.forEach((setting) => {
        if (!(setting.key in lastValidValues.current) && typeof setting.controller_props.value === 'string') {
          lastValidValues.current[setting.key] = setting.controller_props.value
        }
      })
    }
  }, [provider?.settings])

  // Clear importing state when model appears in the provider's model list
  useEffect(() => {
    if (importingModel && provider?.models) {
      const modelExists = provider.models.some(
        (model) => model.id === importingModel
      )
      if (modelExists) {
        setImportingModel(null)
      }
    }
  }, [importingModel, provider?.models])

  // Fallback: Clear importing state after 10 seconds to prevent infinite loading
  useEffect(() => {
    if (importingModel) {
      const timeoutId = setTimeout(() => {
        setImportingModel(null)
      }, 10000) // 10 seconds fallback

      return () => clearTimeout(timeoutId)
    }
  }, [importingModel])

  const handleSettingBlur = (settingKey: string) => {
    if (!provider) return
    const currentValue = provider.settings.find((s) => s.key === settingKey)
      ?.controller_props.value
    const strValue = typeof currentValue === 'string' ? currentValue : ''

    const error = validateSettingValue(settingKey, strValue)
    if (error) {
      setValidationErrors((prev) => ({ ...prev, [settingKey]: error }))
      const lastGood = lastValidValues.current[settingKey]
      if (lastGood !== undefined) {
        const settingIndex = provider.settings.findIndex(
          (s) => s.key === settingKey
        )
        if (settingIndex >= 0) {
          const newSettings = [...provider.settings]
          ;(
            newSettings[settingIndex].controller_props as {
              value: string | boolean | number
            }
          ).value = lastGood

          const updateObj: Partial<ModelProvider> = { settings: newSettings }
          if (settingKey === 'api-key') {
            updateObj.api_key = lastGood
          } else if (settingKey === 'base-url') {
            updateObj.base_url = lastGood
          }

          serviceHub
            .providers()
            .updateSettings(providerName, updateObj.settings ?? [])
          updateProvider(providerName, { ...provider, ...updateObj })
        }
      }
    } else {
      setValidationErrors((prev) => {
        const next = { ...prev }
        delete next[settingKey]
        return next
      })
      if (strValue) {
        lastValidValues.current[settingKey] = strValue
      }
    }
  }

  const handleTestConnection = async () => {
    if (!provider || !provider.base_url) {
      setConnectionStatus('error')
      setConnectionMessage('Base URL is required to test connection.')
      return
    }

    setConnectionStatus('testing')
    setConnectionMessage('')

    try {
      const modelIds = await serviceHub
        .providers()
        .fetchModelsFromProvider(provider)

      setConnectionStatus('success')
      setConnectionMessage(
        t('providers:refreshModelsSuccess', {
          count: modelIds.length,
          provider: provider.provider,
          defaultValue: `Connection successful. Found ${modelIds.length} model(s).`,
        })
      )
    } catch (error) {
      setConnectionStatus('error')
      setConnectionMessage(
        error instanceof Error
          ? error.message
          : t('providers:refreshModelsFailed', {
              provider: provider.provider,
              defaultValue: `Failed to connect to ${provider.provider}.`,
            })
      )
    }
  }

  // Note: settingsChanged event is now handled globally in GlobalEventHandler
  // This ensures all screens receive the event intermediately

  /** Import a list of model IDs into the provider, preserving existing model data. */
  const importModelIds = useCallback(
    (modelIds: string[]) => {
      if (!provider) return
      const selectedSet = new Set(modelIds)
      const existingById = new Map(provider.models.map((m) => [m.id, m]))

      const updatedModels: Model[] = []
      let added = 0
      for (const id of modelIds) {
        if (existingById.has(id)) {
          updatedModels.push(existingById.get(id)!)
        } else {
          updatedModels.push({
            id,
            model: id,
            name: id,
            capabilities: getModelCapabilities(provider.provider, id),
            version: '1.0',
          })
          added++
        }
      }

      const removed = provider.models.filter((m) => !selectedSet.has(m.id)).length

      updateProvider(providerName, { ...provider, models: updatedModels })

      const parts: string[] = []
      if (added > 0) parts.push(`${added} added`)
      if (removed > 0) parts.push(`${removed} removed`)
      if (parts.length > 0) {
        toast.success(t('providers:models'), {
          description: `Models updated: ${parts.join(', ')}.`,
        })
      } else {
        toast.success(t('providers:models'), {
          description: t('providers:noNewModels'),
        })
      }
    },
    [provider, providerName, updateProvider, t],
  )

  const handleRefreshModels = async () => {
    if (!provider || !provider.base_url) {
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsError'),
      })
      return
    }

    setRefreshingModels(true)
    try {
      const modelIds = await serviceHub
        .providers()
        .fetchModelsFromProvider(provider)

      // Detect multi-upstream gateway: if models have 2+ distinct prefixes,
      // show a selection dialog so the user can pick which upstreams to import.
      const groups = groupModelsByPrefix(modelIds)
      if (groups.length > 1) {
        setPendingGroups(groups)
        return
      }

      // Single-prefix provider: import directly (existing behavior)
      const existingModelIds = provider.models.map((m) => m.id)
      const newIds = modelIds.filter((id) => !existingModelIds.includes(id))

      if (newIds.length > 0) {
        const newModels: Model[] = newIds.map((id) => ({
          id,
          model: id,
          name: id,
          capabilities: getModelCapabilities(provider.provider, id),
          version: '1.0',
        }))
        updateProvider(providerName, {
          ...provider,
          models: [...provider.models, ...newModels],
        })
        toast.success(t('providers:models'), {
          description: t('providers:refreshModelsSuccess', {
            count: newIds.length,
            provider: provider.provider,
          }),
        })
      } else {
        toast.success(t('providers:models'), {
          description: t('providers:noNewModels'),
        })
      }
    } catch (error) {
      console.error(
        t('providers:refreshModelsFailed', { provider: provider.provider }),
        error
      )
      toast.error(t('providers:models'), {
        description: t('providers:refreshModelsFailed', {
          provider: provider.provider,
        }),
      })
    } finally {
      setRefreshingModels(false)
    }
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {/* Sticky header with provider avatar */}
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div
              className="size-7 rounded-lg flex items-center justify-center shadow-sm"
              style={{
                backgroundColor: providerColor + '18',
                border: `1px solid ${providerColor}30`,
              }}
            >
              <ProvidersAvatar provider={provider ?? { provider: providerName, active: true, models: [], settings: [] } as ProviderObject} />
            </div>
            <h1 className="text-foreground tracking-tight" style={{ fontSize: '16px', fontWeight: 600 }}>
              {getProviderTitle(providerName)}
            </h1>
          </div>

          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* Settings Section */}
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-foreground tracking-tight mb-1" style={{ fontSize: '16px', fontWeight: 600 }}>
                      {t('provider:configuration', { defaultValue: 'Configuration' })}
                    </h2>
                    <p className="text-muted-foreground" style={{ fontSize: '13px' }}>
                      {t('provider:configurationDesc', { defaultValue: 'API credentials and endpoint settings.' })}
                    </p>
                  </div>
                </div>

                <Card>
                  {provider?.settings.map((setting, settingIndex) => {
                    const actionComponent = (
                      <div
                        className="mt-2"
                        onBlur={(e) => {
                          if (
                            !e.currentTarget.contains(
                              e.relatedTarget as Node
                            )
                          ) {
                            handleSettingBlur(setting.key)
                          }
                        }}
                      >
                        <DynamicControllerSetting
                          controllerType={setting.controller_type}
                          controllerProps={setting.controller_props}
                          className={cn(setting.key === 'device' && 'hidden')}
                          onChange={(newValue) => {
                            if (provider) {
                              const settingKey = setting.key
                              const error = validateSettingValue(
                                settingKey,
                                newValue
                              )
                              setValidationErrors((prev) => {
                                const next = { ...prev }
                                if (error) {
                                  next[settingKey] = error
                                } else {
                                  delete next[settingKey]
                                }
                                return next
                              })

                              if (error) return

                              const newSettings = [...provider.settings]
                              ;(
                                newSettings[settingIndex].controller_props as {
                                  value: string | boolean | number
                                }
                              ).value = newValue

                              const updateObj: Partial<ModelProvider> = {
                                settings: newSettings,
                              }
                              if (
                                settingKey === 'api-key' &&
                                typeof newValue === 'string'
                              ) {
                                updateObj.api_key = newValue
                                lastValidValues.current[settingKey] = newValue
                              } else if (
                                settingKey === 'base-url' &&
                                typeof newValue === 'string'
                              ) {
                                updateObj.base_url = newValue
                                lastValidValues.current[settingKey] = newValue
                              }

                              serviceHub
                                .providers()
                                .updateSettings(
                                  providerName,
                                  updateObj.settings ?? []
                                )
                              updateProvider(providerName, {
                                ...provider,
                                ...updateObj,
                              })

                              if (connectionStatus !== 'idle') {
                                setConnectionStatus('idle')
                                setConnectionMessage('')
                              }
                            }
                          }}
                        />
                        {validationErrors[setting.key] && (
                          <p className="text-red-500 text-xs mt-1">
                            {validationErrors[setting.key]}
                          </p>
                        )}
                      </div>
                    )

                    return (
                      <CardItem
                        key={settingIndex}
                        title={setting.title}
                        className={cn(setting.key === 'device' && 'hidden')}
                        column={
                          setting.controller_type === 'input' &&
                          setting.controller_props.type !== 'number'
                        }
                        description={
                          <RenderMarkdown
                            className="![>p]:text-muted-foreground select-none"
                            content={setting.description}
                            components={{
                              a: ({ ...props }) => {
                                return (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                )
                              },
                              p: ({ ...props }) => (
                                <p {...props} className="mb-0!" />
                              ),
                            }}
                          />
                        }
                        actions={actionComponent}
                      />
                    )
                  })}

                  <DeleteProvider provider={provider} />

                  <CardItem
                    title={
                      <div className="flex items-center gap-2">
                        <Plug className="size-3.5 text-muted-foreground" />
                        <span>{t('providers:testConnection')}</span>
                      </div>
                    }
                    description={
                      connectionStatus === 'success' ? (
                        <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="size-3" />
                          <span>{connectionMessage}</span>
                        </div>
                      ) : connectionStatus === 'error' ? (
                        <div className="flex items-start gap-1 text-red-500">
                          <XCircle className="size-3 mt-0.5 shrink-0" />
                          <span>{connectionMessage}</span>
                        </div>
                      ) : null
                    }
                    actions={
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg h-8 text-[12px]"
                        onClick={handleTestConnection}
                        disabled={connectionStatus === 'testing' || !provider?.base_url}
                      >
                        {connectionStatus === 'testing' ? (
                          <IconLoader
                            size={14}
                            className="text-muted-foreground animate-spin mr-1.5"
                          />
                        ) : null}
                        {connectionStatus === 'testing'
                          ? t('providers:refreshing')
                          : t('providers:testConnection')}
                      </Button>
                    }
                  />
                </Card>
              </div>

              {/* Models Section */}
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-foreground tracking-tight mb-1" style={{ fontSize: '16px', fontWeight: 600 }}>
                      {t('providers:models')}
                    </h2>
                    <p className="text-muted-foreground" style={{ fontSize: '13px' }}>
                      {t('provider:modelsDesc', { defaultValue: 'Available models for this provider.' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <div className="relative">
                      <Search
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground size-3.5"
                      />
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={t('common:searchModels', { defaultValue: 'Search models...' })}
                        className="h-8 w-44 rounded-lg border border-input bg-background pl-8 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    {provider && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-lg h-8 text-[12px]"
                          onClick={handleRefreshModels}
                          disabled={refreshingModels}
                        >
                          {refreshingModels ? (
                            <IconLoader
                              size={14}
                              className="text-muted-foreground animate-spin mr-1.5"
                            />
                          ) : (
                            <RefreshCw className="size-3 mr-1.5" />
                          )}
                          {t('provider:refresh', { defaultValue: 'Refresh' })}
                        </Button>
                        <DialogAddModel provider={provider} />
                      </>
                    )}
                  </div>
                </div>

                <Card>
                  {provider?.models.length ? (
                    provider?.models
                    .filter((model) => {
                      if (!modelSearch) return true
                      const search = modelSearch.toLowerCase()
                      return (
                        model.id.toLowerCase().includes(search) ||
                        model.name?.toLowerCase().includes(search) ||
                        getModelDisplayName(model).toLowerCase().includes(search)
                      )
                    })
                    .map((model, modelIndex) => {
                      const capabilities = model.capabilities || []
                      return (
                        <CardItem
                          key={modelIndex}
                          title={
                            <div className="flex items-center gap-2">
                              <span
                                className="font-medium line-clamp-1"
                                title={model.id}
                              >
                                {getModelDisplayName(model)}
                              </span>
                              <Capabilities capabilities={capabilities} />
                            </div>
                          }
                          actions={
                            <div className="flex items-center gap-0.5">
                              <DialogEditModel
                                provider={provider}
                                modelId={model.id}
                              />
                              {model.settings && (
                                <ModelSetting provider={provider} model={model} />
                              )}
                              {((provider &&
                                !predefinedProviders.some(
                                  (p) => p.provider === provider.provider
                                )) ||
                                (provider &&
                                  predefinedProviders.some(
                                    (p) => p.provider === provider.provider
                                  ) &&
                                  Boolean(provider.api_key?.length))) && (
                                <FavoriteModelAction model={model} />
                              )}
                              <DialogDeleteModel
                                provider={provider}
                                modelId={model.id}
                              />
                            </div>
                          }
                        />
                      )
                    })
                  ) : (
                    <div className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <h6 className="font-medium" style={{ fontSize: '13px' }}>
                          {t('providers:noModelFound')}
                        </h6>
                      </div>
                      <p className="text-muted-foreground mt-1 leading-relaxed" style={{ fontSize: '12px' }}>
                        {t('providers:noModelFoundDesc')}
                        &nbsp;
                        <Link to={route.hub.index} className="text-primary hover:underline">
                          {t('common:hub')}
                        </Link>
                      </p>
                    </div>
                  )}
                  {/* Show importing skeleton first if there's one */}
                  {importingModel && (
                    <CardItem
                      key="importing-skeleton"
                      title={
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 animate-pulse">
                            <div className="flex gap-2 px-2 py-1 rounded-full text-xs">
                              <IconLoader
                                size={16}
                                className="animate-spin"
                              />
                              Importing...
                            </div>
                            <span className="font-medium line-clamp-1">
                              {importingModel}
                            </span>
                          </div>
                        </div>
                      }
                    />
                  )}
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Model group selection dialog for multi-upstream gateways */}
      {provider && pendingGroups && (
        <SelectModelGroups
          open={!!pendingGroups}
          onOpenChange={(open) => { if (!open) setPendingGroups(null) }}
          groups={pendingGroups}
          existingModelIds={new Set(provider.models.map((m) => m.id))}
          onConfirm={(selectedIds) => {
            importModelIds(selectedIds)
            setPendingGroups(null)
          }}
        />
      )}
    </div>
  )
}
