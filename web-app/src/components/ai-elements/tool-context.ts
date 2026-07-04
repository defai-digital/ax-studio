import { createContext, useContext } from 'react'
import type { ToolUIPart } from 'ai'

export type ToolState = ToolUIPart['state'] | 'output-denied'

export type ToolContextValue = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  state: ToolState
}

export const ToolContext = createContext<ToolContextValue | null>(null)

export function useTool() {
  const context = useContext(ToolContext)
  if (!context) {
    throw new Error('Tool components must be used within Tool')
  }
  return context
}
