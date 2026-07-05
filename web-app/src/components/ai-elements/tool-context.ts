import type { ToolUIPart } from 'ai'
import { createStrictContext } from './strict-context'

export type ToolState = ToolUIPart['state'] | 'output-denied'

export type ToolContextValue = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  state: ToolState
}

const [ToolContext, useToolContext] = createStrictContext<ToolContextValue>(
  'Tool components must be used within Tool'
)

export { ToolContext }

export function useTool() {
  return useToolContext()
}
