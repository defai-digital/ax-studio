import { createStrictContext } from './strict-context'

export type ReasoningContextValue = {
  isStreaming: boolean
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  duration: number | undefined
}

const [ReasoningContext, useReasoningContext] =
  createStrictContext<ReasoningContextValue>(
    'Reasoning components must be used within Reasoning'
  )

export { ReasoningContext }

export function useReasoning() {
  return useReasoningContext()
}
