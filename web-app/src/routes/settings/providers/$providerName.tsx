import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getProviderColor, getModelDisplayName } from '@/lib/utils'
import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Capabilities from '@/containers/Capabilities'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { DialogEditModel } from '@/containers/dialogs/EditModel'
import { ModelSetting } from '@/containers/ModelSetting'
import { DialogDeleteModel } from '@/containers/dialogs/DeleteModel'
import { FavoriteModelAction } from '@/containers/FavoriteModelAction'
import { route } from '@/constants/routes'
import DeleteProvider from '@/containers/dialogs/DeleteProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Button } from '@/components/ui/button'
import {
  IconLoader,
} from '@tabler/icons-react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { predefinedProviders } from '@/constants/providers'
import { DialogAddModel } from '@/containers/dialogs/AddModel'
import ProvidersAvatar from '@/containers/ProvidersAvatar'

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
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)
  const providerColor = getProviderColor(providerName)

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

  // Note: settingsChanged event is now handled globally in GlobalEventHandler
  // This ensures all screens receive the event intermediately

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

      // Create new models from the fetched IDs
      const newModels: Model[] = modelIds.map((id) => ({
        id,
        model: id,
        name: id,
        capabilities: ['completion'], // Default capability
        version: '1.0',
      }))

      // Filter out models that already exist
      const existingModelIds = provider.models.map((m) => m.id)
      const modelsToAdd = newModels.filter(
        (model) => !existingModelIds.includes(model.id)
      )

      if (modelsToAdd.length > 0) {
        // Update the provider with new models
        const updatedModels = [...provider.models, ...modelsToAdd]
        updateProvider(providerName, {
          ...provider,
          models: updatedModels,
        })

        toast.success(t('providers:models'), {
          description: t('providers:refreshModelsSuccess', {
            count: modelsToAdd.length,
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
                      <div className="mt-2">
                        <DynamicControllerSetting
                          controllerType={setting.controller_type}
                          controllerProps={setting.controller_props}
                          className={cn(setting.key === 'device' && 'hidden')}
                          onChange={(newValue) => {
                            if (provider) {
                              const newSettings = [...provider.settings]
                              ;(
                                newSettings[settingIndex].controller_props as {
                                  value: string | boolean | number
                                }
                              ).value = newValue

                              const updateObj: Partial<ModelProvider> = {
                                settings: newSettings,
                              }
                              const settingKey = setting.key
                              if (
                                settingKey === 'api-key' &&
                                typeof newValue === 'string'
                              ) {
                                updateObj.api_key = newValue
                              } else if (
                                settingKey === 'base-url' &&
                                typeof newValue === 'string'
                              ) {
                                updateObj.base_url = newValue
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
                            }
                          }}
                        />
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
                    provider?.models.map((model, modelIndex) => {
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
    </div>
  )
}
