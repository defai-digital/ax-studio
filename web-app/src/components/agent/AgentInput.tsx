import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SendHorizonal, Loader2 } from 'lucide-react'
import type { AxAgent } from '@/hooks/agent/useAgentMode'

const PROVIDERS = [
  { value: 'opencode', label: 'OpenCode (default)' },
  { value: '', label: 'Auto' },
  { value: 'claude', label: 'Claude (Anthropic)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini (Google)' },
  { value: 'grok', label: 'Grok (xAI)' },
  { value: 'groq', label: 'Groq' },
  { value: 'opencode', label: 'OpenCode (GLM / multi-model)' },
  { value: 'local-llm', label: 'Local LLM' },
]

const MODEL_HINTS: Record<string, string> = {
  opencode: 'e.g. ollama-cloud/glm-4.7',
  claude: 'e.g. claude-sonnet-4-6',
  openai: 'e.g. gpt-4o',
  gemini: 'e.g. gemini-2.5-flash',
  grok: 'e.g. grok-3',
  groq: 'e.g. llama-3.3-70b-versatile',
}

type Props = {
  agents: AxAgent[]
  selectedAgent: string
  onSelectAgent: (id: string) => void
  selectedProvider: string | null
  onSelectProvider: (provider: string | null) => void
  selectedModel: string | null
  onSelectModel: (model: string | null) => void
  onSubmit: (message: string) => Promise<void>
  isRunning: boolean
  axError?: string | null
}

export function AgentInput({
  agents,
  selectedAgent,
  onSelectAgent,
  selectedProvider,
  onSelectProvider,
  selectedModel,
  onSelectModel,
  onSubmit,
  isRunning,
  axError,
}: Props) {
  const [value, setValue] = useState('')

  const handleSubmit = async () => {
    const text = value.trim()
    if (!text || isRunning) return
    setValue('')
    await onSubmit(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const enabledAgents = agents.filter((a) => a.enabled)
  const displayAgents = enabledAgents.length > 0 ? enabledAgents : agents

  if (axError) {
    return (
      <div className="rounded-xl border bg-background px-3 py-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-destructive">AutomatosX not found</p>
        <p>Install it with: <code className="bg-muted px-1 rounded">npm install -g @defai.digital/cli</code></p>
        <p className="text-xs opacity-70">{axError}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-background px-3 py-2 shadow-sm">
      <div className="flex gap-2">
        {displayAgents.length > 0 && (
          <select
            value={selectedAgent}
            onChange={(e) => onSelectAgent(e.target.value)}
            disabled={isRunning}
            className="h-7 flex-1 rounded-md bg-muted/40 px-2 text-xs border-0 focus:outline-none"
          >
            {displayAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.id}{agent.description ? ` — ${agent.description}` : ''}
              </option>
            ))}
          </select>
        )}
        <select
          value={selectedProvider ?? ''}
          onChange={(e) => onSelectProvider(e.target.value || null)}
          disabled={isRunning}
          className="h-7 flex-1 rounded-md bg-muted/40 px-2 text-xs border-0 focus:outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={selectedModel ?? ''}
          onChange={(e) => onSelectModel(e.target.value || null)}
          disabled={isRunning}
          placeholder={selectedProvider ? (MODEL_HINTS[selectedProvider] ?? 'Model (optional)') : 'Model (optional)'}
          className="h-7 flex-1 rounded-md bg-muted/40 px-2 text-xs border border-transparent focus:outline-none focus:border-border"
        />
      </div>
      <div className="flex gap-2 items-end">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Agent is running...' : 'Describe a task for the selected agent...'}
          disabled={isRunning}
          rows={1}
          className="flex-1 resize-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 text-sm min-h-[24px] max-h-32"
        />
        <Button
          size="icon-sm"
          onClick={handleSubmit}
          disabled={!value.trim() || isRunning}
          aria-label="Run agent"
        >
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizonal className="size-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
