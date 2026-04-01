import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useNavigate } from '@tanstack/react-router'
import { cn, getProviderTitle, getProviderColor, getProviderDescription } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { AddProviderDialog } from '@/containers/dialogs'
import { Switch } from '@/components/ui/switch'
import { useCallback } from 'react'
import { openAIProviderSettings } from '@/constants/providers'
import cloneDeep from 'lodash/cloneDeep'
import { toast } from 'sonner'
import { Plug, Plus, ChevronRight } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.model_providers as any)({
  component: ModelProviders,
})

function ModelProviders() {
  const { t } = useTranslation()
  const { providers, addProvider, updateProvider } = useModelProvider()
  const navigate = useNavigate()

  const createProvider = useCallback(
    (name: string) => {
      if (
        providers.some((e) => e.provider.toLowerCase() === name.toLowerCase())
      ) {
        toast.error(t('providerAlreadyExists', { name }))
        return
      }
      const newProvider: ProviderObject = {
        provider: name,
        active: true,
        models: [],
        settings: cloneDeep(openAIProviderSettings) as ProviderSetting[],
        api_key: '',
        base_url: 'https://api.openai.com/v1',
      }
      addProvider(newProvider)
      setTimeout(() => {
        navigate({
          to: route.settings.providers,
          params: {
            providerName: name,
          },
        })
      }, 0)
    },
    [providers, addProvider, t, navigate]
  )

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <Plug className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-foreground tracking-tight" style={{ fontSize: '16px', fontWeight: 600 }}>
              {t('common:modelProviders')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl">
              {/* Section header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-foreground tracking-tight mb-1" style={{ fontSize: '16px', fontWeight: 600 }}>
                    {t('common:modelProviders')}
                  </h2>
                  <p className="text-muted-foreground" style={{ fontSize: '13px' }}>
                    {t('provider:connectDescription', { defaultValue: 'Connect external APIs and local model engines.' })}
                  </p>
                </div>
                <div className="shrink-0 ml-4">
                  <AddProviderDialog
                    onCreateProvider={createProvider}
                    existingProviderNames={providers.map((p) => p.provider)}
                  >
                    <Button className="rounded-lg h-8 text-[12px]">
                      <Plus className="size-3 mr-1.5" />
                      {t('provider:addProvider')}
                    </Button>
                  </AddProviderDialog>
                </div>
              </div>

              {/* Provider cards */}
              <div className="space-y-2">
                {providers.map((provider) => {
                  const color = getProviderColor(provider.provider)
                  const desc = getProviderDescription(provider.provider)

                  return (
                    <div
                      key={provider.provider}
                      className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden"
                    >
                      <div className="flex items-center gap-4 px-4 py-3.5">
                        {/* Provider icon */}
                        <div
                          className="size-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
                          style={{
                            backgroundColor: color + '18',
                            border: `1px solid ${color}30`,
                          }}
                        >
                          <ProvidersAvatar provider={provider} />
                        </div>

                        {/* Provider info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-medium text-foreground" style={{ fontSize: '13px' }}>
                              {getProviderTitle(provider.provider)}
                            </span>
                            {provider.active && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                                Active
                              </span>
                            )}
                          </div>
                          <span className="text-muted-foreground" style={{ fontSize: '12px' }}>
                            {desc} · {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={provider.active}
                            onCheckedChange={(checked) => {
                              updateProvider(provider.provider, {
                                ...provider,
                                active: checked,
                              })
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-lg size-8 hover:bg-muted"
                            onClick={() => {
                              navigate({
                                to: route.settings.providers,
                                params: {
                                  providerName: provider.provider,
                                },
                              })
                            }}
                          >
                            <ChevronRight className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
