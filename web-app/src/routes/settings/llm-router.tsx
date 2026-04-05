import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Route as RouteIcon, Info, Check, ChevronsUpDown } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Card, CardItem } from '@/components/common/Card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useRouterSettings } from '@/hooks/settings/useRouterSettings'
import { useModelProvider } from '@/hooks/models/useModelProvider'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.llm_router as any)({
  component: LLMRouterSettings,
})

function LLMRouterSettings() {
  const enabled = useRouterSettings((s) => s.enabled)
  const routerModelId = useRouterSettings((s) => s.routerModelId)
  const routerProviderId = useRouterSettings((s) => s.routerProviderId)
  const timeout = useRouterSettings((s) => s.timeout)
  const setEnabled = useRouterSettings((s) => s.setEnabled)
  const setRouterModel = useRouterSettings((s) => s.setRouterModel)
  const setTimeoutMs = useRouterSettings((s) => s.setTimeoutMs)

  const providers = useModelProvider((s) => s.providers)

  // Build a flat list of all available models (non-embedding) for the router model dropdown.
  // Only include providers with an API key configured so the router can actually reach them.
  const availableModels = useMemo(() => {
    const models: { id: string; provider: string; displayName: string }[] = []
    for (const provider of providers) {
      if (!provider.active) continue
      if (!provider.api_key?.length && !provider.models.length) continue
      for (const model of provider.models) {
        if (model.embedding) continue
        models.push({
          id: model.id,
          provider: provider.provider,
          displayName: model.displayName ?? model.name ?? model.id,
        })
      }
    }
    return models
  }, [providers])

  const routerModelAvailable = useMemo(() => {
    if (!routerModelId || !routerProviderId) return false
    return availableModels.some(
      (m) => m.id === routerModelId && m.provider === routerProviderId,
    )
  }, [routerModelId, routerProviderId, availableModels])

  const selectedRouterModelLabel = useMemo(() => {
    if (!routerModelId || !routerProviderId) return null
    const found = availableModels.find(
      (m) => m.id === routerModelId && m.provider === routerProviderId,
    )
    return found ? `${found.displayName} (${found.provider})` : `${routerModelId} (${routerProviderId})`
  }, [routerModelId, routerProviderId, availableModels])

  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  // Group models by provider for the command list
  const groupedModels = useMemo(() => {
    const groups: Record<string, typeof availableModels> = {}
    for (const model of availableModels) {
      if (!groups[model.provider]) groups[model.provider] = []
      groups[model.provider].push(model)
    }
    return groups
  }, [availableModels])

  const handleModelSelect = (modelId: string, provider: string) => {
    setRouterModel(modelId, provider)
    setModelPickerOpen(false)
  }

  const handleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (!isNaN(val)) setTimeoutMs(val)
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">Settings</span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div
              className="size-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}
            >
              <RouteIcon className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              LLM Router
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* Enable/Disable */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="font-medium text-foreground text-base">
                      LLM Router
                    </h1>
                    <Switch
                      checked={enabled}
                      onCheckedChange={setEnabled}
                    />
                  </div>
                }
              >
                <CardItem
                  title="Automatic model selection"
                  description="When enabled, the router model analyzes each message and picks the best model from your connected providers."
                  align="start"
                />
              </Card>

              {/* Router Model Selection */}
              <Card title="Router Model">
                <CardItem
                  title="Classification model"
                  description="The model that decides which model to use for each message. Pick a fast, affordable model for best results."
                  column
                  actions={
                    <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full h-9 items-center justify-between rounded-md border border-border/60 bg-background px-3 text-sm text-foreground hover:bg-accent/50 focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!enabled}
                        >
                          <span className={selectedRouterModelLabel ? '' : 'text-muted-foreground'}>
                            {selectedRouterModelLabel ?? 'Select a model...'}
                          </span>
                          <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0 ml-2" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search models..." />
                          <CommandList>
                            <CommandEmpty>No models found.</CommandEmpty>
                            {Object.entries(groupedModels).map(([provider, models]) => (
                              <CommandGroup key={provider} heading={provider}>
                                {models.map((model) => {
                                  const isSelected = model.id === routerModelId && model.provider === routerProviderId
                                  return (
                                    <CommandItem
                                      key={`${model.provider}::${model.id}`}
                                      value={`${model.displayName} ${model.id} ${model.provider}`}
                                      onSelect={() => handleModelSelect(model.id, model.provider)}
                                    >
                                      <Check className={`size-3.5 shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                                      <span className="truncate">{model.displayName}</span>
                                    </CommandItem>
                                  )
                                })}
                              </CommandGroup>
                            ))}
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  }
                />
                {selectedRouterModelLabel && (
                  <div className="px-5 pb-4">
                    <p className="text-xs text-muted-foreground">
                      Currently using: <span className="font-medium text-foreground">{selectedRouterModelLabel}</span>
                    </p>
                  </div>
                )}
                {enabled && routerModelId && !routerModelAvailable && (
                  <div className="px-5 pb-4">
                    <p className="text-xs text-destructive">
                      The configured router model is no longer available. Routing will fall back to your selected model.
                      Please select a different router model.
                    </p>
                  </div>
                )}
                <div className="px-5 pb-4 flex items-start gap-2">
                  <Info className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Recommended: GPT-4o Mini, Claude Haiku, Gemini Flash, or a local 8B model.
                    The router uses ~200-400 tokens per classification.
                  </p>
                </div>
              </Card>

              {/* Timeout */}
              <Card title="Timeout">
                <CardItem
                  title="Classification timeout"
                  description="Maximum time (in milliseconds) to wait for the router model to decide. If exceeded, your currently selected model is used."
                  column
                  actions={
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={500}
                        max={30000}
                        step={500}
                        value={timeout}
                        onChange={handleTimeoutChange}
                        className="w-32 h-9 text-sm"
                        disabled={!enabled}
                      />
                      <span className="text-sm text-muted-foreground">ms</span>
                    </div>
                  }
                />
              </Card>

              {/* How it works */}
              <Card title="How it works">
                <div className="px-5 py-4 space-y-3">
                  {[
                    { step: '1', text: 'You send a message' },
                    { step: '2', text: 'The router model analyzes your message and the list of available models' },
                    { step: '3', text: 'It picks the best model based on the task type and model strengths' },
                    { step: '4', text: 'Your message is sent to the chosen model' },
                    { step: '5', text: 'If the router fails or times out, your selected model is used' },
                  ].map(({ step, text }) => (
                    <div key={step} className="flex items-start gap-3">
                      <span className="size-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                        {step}
                      </span>
                      <span className="text-sm text-muted-foreground leading-relaxed">
                        {text}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
