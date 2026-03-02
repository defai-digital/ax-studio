/* eslint-disable @typescript-eslint/no-explicit-any */
import { Card, CardItem } from '@/containers/Card'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { useModelProvider } from '@/hooks/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName } from '@/lib/utils'
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
  IconRefresh,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { predefinedProviders } from '@/constants/providers'
import { DialogAddModel } from '@/containers/dialogs/AddModel'

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
  const { providerName } = useParams({ from: Route.id })
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName(providerName)

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
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <div className="flex items-center justify-between">
              <h1 className="font-medium text-base">
                {getProviderTitle(providerName)}
              </h1>
            </div>

            <div className="flex flex-col gap-3">
              {/* Settings */}
              <Card>
                {provider?.settings.map((setting, settingIndex) => {
                  // Use the DynamicController component
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
                          ? true
                          : false
                      }
                      description={
                        <>
                          <RenderMarkdown
                            className="![>p]:text-muted-foreground select-none"
                            content={setting.description}
                            components={{
                              // Make links open in a new tab
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
                        </>
                      }
                      actions={actionComponent}
                    />
                  )
                })}

                <DeleteProvider provider={provider} />
              </Card>

              {/* Models */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-foreground font-medium text-base">
                      {t('providers:models')}
                    </h1>
                    <div className="flex items-center gap-2">
                      {provider && (
                        <>
                          <Button
                            variant="secondary"
                            size="icon-xs"
                            onClick={handleRefreshModels}
                            disabled={refreshingModels}
                          >
                            {refreshingModels ? (
                              <IconLoader
                                size={18}
                                className="text-muted-foreground animate-spin"
                              />
                            ) : (
                              <IconRefresh
                                size={18}
                                className="text-muted-foreground"
                              />
                            )}
                          </Button>
                          <DialogAddModel provider={provider} />
                        </>
                      )}
                    </div>
                  </div>
                }
              >
                {provider?.models.length ? (
                  provider?.models.map((model, modelIndex) => {
                    const capabilities = model.capabilities || []
                    return (
                      <CardItem
                        key={modelIndex}
                        title={
                          <div className="flex items-center gap-2">
                            <h1
                              className="font-medium line-clamp-1"
                              title={model.id}
                            >
                              {getModelDisplayName(model)}
                            </h1>
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
                  <div className="-mt-2">
                    <div className="flex items-center gap-2">
                      <h6 className="font-medium text-base">
                        {t('providers:noModelFound')}
                      </h6>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {t('providers:noModelFoundDesc')}
                      &nbsp;
                      <Link to={route.hub.index}>{t('common:hub')}</Link>
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
                          <h1 className="font-medium line-clamp-1">
                            {importingModel}
                          </h1>
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
  )
}
