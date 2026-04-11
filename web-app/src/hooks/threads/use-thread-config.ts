/**
 * useThreadConfig — derives promptResolution and optimizedModelConfig from thread state.
 * Pure memos; no effects, no subscriptions.
 */
import { useMemo } from 'react'
import { resolveSystemPrompt, getOptimizedModelConfig } from '@/lib/system-prompt'

type Input = {
  thread: Thread | undefined
  selectedModel: Model | undefined
  globalDefaultPrompt: string
  autoTuningEnabled: boolean
  threadMessageCount: number
}

export function useThreadConfig({
  thread,
  selectedModel,
  globalDefaultPrompt,
  autoTuningEnabled,
  threadMessageCount,
}: Input) {
  const promptResolution = useMemo(
    () =>
      resolveSystemPrompt(
        thread?.metadata?.threadPrompt,
        thread?.metadata?.project?.projectPrompt,
        { globalDefaultPrompt }
      ),
    [globalDefaultPrompt, thread?.metadata?.project?.projectPrompt, thread?.metadata?.threadPrompt]
  )

  const optimizedModelConfig = useMemo(() => {
    const baseConfig = {
      temperature: thread?.assistants?.[0]?.parameters?.temperature as number | undefined,
      top_p: thread?.assistants?.[0]?.parameters?.top_p as number | undefined,
      max_output_tokens: thread?.assistants?.[0]?.parameters?.max_output_tokens as number | undefined,
      modelId: selectedModel?.id,
    }
    if (!autoTuningEnabled) return baseConfig
    return getOptimizedModelConfig(
      {
        promptLength: promptResolution.resolvedPrompt.length,
        messageCount: threadMessageCount,
        hasAttachments: Boolean(thread?.metadata?.hasDocuments),
        modelCapabilities: selectedModel?.capabilities,
      },
      baseConfig
    )
  }, [
    autoTuningEnabled,
    promptResolution.resolvedPrompt.length,
    selectedModel?.id,
    selectedModel?.capabilities,
    thread?.assistants,
    thread?.metadata?.hasDocuments,
    threadMessageCount,
  ])

  return { promptResolution, optimizedModelConfig }
}
