import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/components/common/Card'
import { DynamicControllerSetting } from '@/containers/dynamicControllerSetting'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { Cog } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Route = createFileRoute(route.settings.engine_settings)({
  component: EngineSettingsContent,
})

// Settings grouped into sections per PRD §8
const SECTION_KEYS: Record<string, string[]> = {
  backend: [
    'engine_type',
    'version_backend',
    'auto_update_engine',
    'llamacpp_env',
    'timeout',
  ],
  memory: ['fit', 'fit_target', 'fit_ctx', 'auto_unload', 'no_mmap', 'mlock'],
  compute: ['threads', 'threads_batch', 'n_predict', 'ubatch_size'],
  gpu: [
    'device',
    'split_mode',
    'main_gpu',
    'n_gpu_layers',
    'offload_mmproj',
    'cpu_moe',
    'n_cpu_moe',
  ],
  attention: [
    'flash_attn',
    'cont_batching',
    'ctx_shift',
    'cache_type_k',
    'cache_type_v',
    'defrag_thold',
  ],
  rope: ['rope_scaling', 'rope_scale', 'rope_freq_base', 'rope_freq_scale'],
  sampling: ['mirostat', 'mirostat_lr', 'mirostat_ent'],
  advanced: ['grammar_file', 'json_schema_file', 'no_kv_offload', 'ctx_size'],
}

function EngineSettingsContent() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { getProviderByName, updateProvider } = useModelProvider()
  const provider = getProviderByName('llamacpp')

  const handleSettingChange = (settingIndex: number, newValue: unknown) => {
    if (!provider) return

    const newSettings = [...provider.settings]
    ;(
      newSettings[settingIndex].controller_props as {
        value: string | boolean | number
      }
    ).value = newValue as string | boolean | number

    serviceHub.providers().updateSettings('llamacpp', newSettings)
    updateProvider('llamacpp', { settings: newSettings })
  }

  const renderSection = (sectionKey: string, keys: string[]) => {
    if (!provider?.settings) return null

    const sectionSettings = keys
      .map((key) => {
        const index = provider.settings.findIndex((s) => s.key === key)
        if (index < 0) return null
        return { setting: provider.settings[index], index }
      })
      .filter(Boolean) as {
      setting: (typeof provider.settings)[0]
      index: number
    }[]

    if (sectionSettings.length === 0) return null

    return (
      <Card
        key={sectionKey}
        title={t(`settings:engineSettings.${sectionKey}` as never)}
      >
        {sectionSettings.map(({ setting, index }) => {
          const actionComponent = (
            <div className="mt-2">
              <DynamicControllerSetting
                controllerType={setting.controller_type}
                controllerProps={setting.controller_props}
                onChange={(newValue) => handleSettingChange(index, newValue)}
              />
            </div>
          )

          return (
            <CardItem
              key={setting.key}
              title={setting.title}
              column={
                setting.controller_type === 'input' &&
                (setting.controller_props as Record<string, unknown>)?.type !== 'number'
              }
              description={
                <RenderMarkdown
                  className="![>p]:text-muted-foreground select-none"
                  content={setting.description ?? ''}
                  components={{
                    a: ({ ...props }) => (
                      <a {...props} target="_blank" rel="noopener noreferrer" />
                    ),
                    p: ({ ...props }) => <p {...props} className="mb-0!" />,
                  }}
                />
              }
              actions={actionComponent}
            />
          )
        })}
      </Card>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div
          className={cn('flex items-center gap-2 w-full', !IS_MACOS && 'pr-30')}
        >
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
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
              <Cog className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              {t('common:engineSettings')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {!provider ? (
                <Card>
                  <CardItem
                    title={t('settings:engineSettings.notAvailable')}
                    actions={<></>}
                  />
                </Card>
              ) : (
                Object.entries(SECTION_KEYS).map(([key, settingKeys]) =>
                  renderSection(key, settingKeys)
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
