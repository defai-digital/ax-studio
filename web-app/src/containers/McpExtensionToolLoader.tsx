import { ComponentType } from 'react'
import { MCPTool, MCPToolComponentProps } from '@ax-studio/core'
import { useToolAvailable } from '@/hooks/tools/useToolAvailable'
import { useThreads } from '@/hooks/threads/useThreads'

interface McpExtensionToolLoaderProps {
  tools: MCPTool[]
  hasActiveMCPServers: boolean
  selectedModelHasTools: boolean
  initialMessage?: boolean
  threadId?: string
  MCPToolComponent?: ComponentType<MCPToolComponentProps> | null
}

export const McpExtensionToolLoader = ({
  tools,
  hasActiveMCPServers,
  selectedModelHasTools,
  initialMessage,
  threadId,
  MCPToolComponent,
}: McpExtensionToolLoaderProps) => {
  // Get tool management hooks
  const { isToolDisabled, setToolDisabledForThread, setDefaultDisabledTools, getDefaultDisabledTools } = useToolAvailable()
  const currentThreadId = useThreads((state) =>
    threadId ?? state.getCurrentThread()?.id
  )
  const effectiveThreadId = threadId ?? currentThreadId

  // Handle tool toggle for custom component
  const handleToolToggle = (toolName: string, enabled: boolean) => {
    const tool = tools.find(t => t.name === toolName)
    if (!tool) return

    const toolKey = `${tool.server}::${toolName}`

    if (initialMessage) {
      const currentDefaults = getDefaultDisabledTools()
      if (enabled) {
        setDefaultDisabledTools(currentDefaults.filter((key) => key !== toolKey))
      } else {
        setDefaultDisabledTools([...currentDefaults, toolKey])
      }
    } else if (effectiveThreadId) {
      setToolDisabledForThread(effectiveThreadId, tool.server, toolName, enabled)
    }
  }

  const isToolEnabled = (toolName: string): boolean => {
    const tool = tools.find(t => t.name === toolName)
    if (!tool) return false

    const toolKey = `${tool.server}::${toolName}`

    if (initialMessage) {
      return !getDefaultDisabledTools().includes(toolKey)
    } else if (effectiveThreadId) {
      return !isToolDisabled(effectiveThreadId, tool.server, toolName)
    }
    return false
  }

  // Only render if we have the custom MCP component and conditions are met
  if (!selectedModelHasTools || !hasActiveMCPServers || !MCPToolComponent) {
    return null
  }

  return (
    <MCPToolComponent
      tools={tools}
      isToolEnabled={isToolEnabled}
      onToolToggle={handleToolToggle}
    />
  )
}
