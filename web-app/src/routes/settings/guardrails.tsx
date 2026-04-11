import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ShieldCheck, Globe, Cpu, Cloud } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useGuardrails, type DataMode } from '@/hooks/settings/useGuardrails'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute(route.settings.guardrails)({
  component: Guardrails,
})

const dataModeOptions: Array<{
  value: DataMode
  label: string
  description: string
  icon: typeof Cpu
}> = [
  {
    value: 'local-only',
    label: 'Local only',
    description: 'All data stays on this device. Cloud models are disabled.',
    icon: Cpu,
  },
  {
    value: 'hybrid',
    label: 'Hybrid',
    description: 'Local models preferred, cloud available when needed.',
    icon: Globe,
  },
  {
    value: 'cloud',
    label: 'Cloud',
    description: 'Use any model, including cloud providers.',
    icon: Cloud,
  },
]

function Guardrails() {
  const { t } = useTranslation()
  const {
    dataMode,
    allowWebSearch,
    alwaysCiteSources,
    flagLowConfidence,
    requireApprovalBeforeEdits,
    setDataMode,
    setAllowWebSearch,
    setAlwaysCiteSources,
    setFlagLowConfidence,
    setRequireApprovalBeforeEdits,
  } = useGuardrails()

  const selectedModel = useModelProvider((s) => s.selectedModel)

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
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div
              className="size-7 rounded-lg flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #059669, #10b981)',
              }}
            >
              <ShieldCheck className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1
                className="text-foreground tracking-tight"
                style={{ fontSize: '16px', fontWeight: 600 }}
              >
                Workspace Guardrails
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Control what your AI can and cannot do
              </p>
            </div>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* Data Rules */}
              <Card
                header={
                  <span className="text-sm font-semibold">Data Rules</span>
                }
              >
                <CardItem
                  title="Data mode"
                  description="Choose where your data is processed"
                  column
                  actions={
                    <RadioGroup
                      value={dataMode}
                      onValueChange={(v) => setDataMode(v as DataMode)}
                      className="space-y-2 w-full"
                    >
                      {dataModeOptions.map((opt) => {
                        const Icon = opt.icon
                        return (
                          <label
                            key={opt.value}
                            className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
                          >
                            <RadioGroupItem
                              value={opt.value}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Icon className="size-3.5 text-muted-foreground" />
                                <span className="text-sm font-medium">
                                  {opt.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {opt.description}
                              </p>
                            </div>
                          </label>
                        )
                      })}
                    </RadioGroup>
                  }
                />
                <CardItem
                  title="Allow web search"
                  description="Enable web search for research tasks"
                  actions={
                    <Switch
                      checked={allowWebSearch}
                      onCheckedChange={setAllowWebSearch}
                    />
                  }
                />
              </Card>

              {/* Content Rules */}
              <Card
                header={
                  <span className="text-sm font-semibold">Content Rules</span>
                }
              >
                <CardItem
                  title="Always cite sources"
                  description="Require the AI to show where information comes from"
                  actions={
                    <Switch
                      checked={alwaysCiteSources}
                      onCheckedChange={setAlwaysCiteSources}
                    />
                  }
                />
                <CardItem
                  title="Flag low confidence"
                  description="Show a warning when the AI is uncertain about its response"
                  actions={
                    <Switch
                      checked={flagLowConfidence}
                      onCheckedChange={setFlagLowConfidence}
                    />
                  }
                />
                <CardItem
                  title="Require approval before edits"
                  description="Ask for confirmation before modifying your content"
                  actions={
                    <Switch
                      checked={requireApprovalBeforeEdits}
                      onCheckedChange={setRequireApprovalBeforeEdits}
                    />
                  }
                />
              </Card>

              {/* Usage Dashboard */}
              <Card
                header={
                  <span className="text-sm font-semibold">Usage</span>
                }
              >
                <CardItem
                  title="Current model"
                  description="The model handling your conversations"
                  actions={
                    <Badge variant="secondary" className="text-xs">
                      {selectedModel?.name ?? selectedModel?.id ?? 'None selected'}
                    </Badge>
                  }
                />
                <CardItem
                  title="Data mode"
                  description="Where your data is being processed"
                  actions={
                    <Badge
                      variant="secondary"
                      className={`text-xs ${
                        dataMode === 'local-only'
                          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                          : dataMode === 'hybrid'
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                      }`}
                    >
                      {dataMode === 'local-only'
                        ? 'Local only'
                        : dataMode === 'hybrid'
                          ? 'Hybrid'
                          : 'Cloud'}
                    </Badge>
                  }
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
