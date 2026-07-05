import { useCallback, useMemo, type ComponentType } from 'react'
import type { MCPTool, MCPToolComponentProps } from '@ax-studio/core'
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
  const {
    isToolDisabled,
    setToolDisabledForThread,
    setDefaultDisabledTools,
    getDefaultDisabledTools,
  } = useToolAvailable()
  const currentThreadId = useThreads(
    (state) => threadId ?? state.getCurrentThread()?.id
  )
  const effectiveThreadId = threadId ?? currentThreadId
  const toolsByName = useMemo(() => {
    const nextToolsByName = new Map<string, MCPTool>()
    tools.forEach((tool) => {
      if (!nextToolsByName.has(tool.name)) {
        nextToolsByName.set(tool.name, tool)
      }
    })
    return nextToolsByName
  }, [tools])

  const handleToolToggle = useCallback(
    (toolName: string, enabled: boolean) => {
      const tool = toolsByName.get(toolName)
      if (!tool) return

      const toolKey = `${tool.server}::${toolName}`

      if (initialMessage) {
        const currentDefaults = getDefaultDisabledTools()
        if (enabled) {
          setDefaultDisabledTools(
            currentDefaults.filter((key) => key !== toolKey)
          )
        } else {
          setDefaultDisabledTools([...currentDefaults, toolKey])
        }
      } else if (effectiveThreadId) {
        setToolDisabledForThread(
          effectiveThreadId,
          tool.server,
          toolName,
          enabled
        )
      }
    },
    [
      effectiveThreadId,
      getDefaultDisabledTools,
      initialMessage,
      setDefaultDisabledTools,
      setToolDisabledForThread,
      toolsByName,
    ]
  )

  const isToolEnabled = useCallback(
    (toolName: string): boolean => {
      const tool = toolsByName.get(toolName)
      if (!tool) return false

      const toolKey = `${tool.server}::${toolName}`

      if (initialMessage) {
        return !getDefaultDisabledTools().includes(toolKey)
      }
      if (effectiveThreadId) {
        return !isToolDisabled(effectiveThreadId, tool.server, toolName)
      }
      return false
    },
    [
      effectiveThreadId,
      getDefaultDisabledTools,
      initialMessage,
      isToolDisabled,
      toolsByName,
    ]
  )

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
