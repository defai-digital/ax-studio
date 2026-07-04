import { useCallback, useEffect, useRef } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from '@/hooks/settings/useAppState'
import { useToolAvailable } from '@/hooks/tools/useToolAvailable'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@ax-studio/core'

export const useTools = () => {
  const serviceHub = useServiceHub()
  const updateTools = useAppState((state) => state.updateTools)
  const updateMcpToolNames = useAppState((state) => state.updateMcpToolNames)
  const refreshGenerationRef = useRef(0)

  const {
    isDefaultsInitialized,
    setDefaultDisabledTools,
    markDefaultsAsInitialized,
  } = useToolAvailable()

  const refreshTools = useCallback(
    async (isCancelled: () => boolean) => {
      const generation = ++refreshGenerationRef.current
      try {
        // Get MCP extension first
        const mcpExtension = ExtensionManager.getInstance().get<MCPExtension>(
          ExtensionTypeEnum.MCP
        )

        // Fetch MCP tools
        const mcpTools = await serviceHub.mcp().getTools()
        if (isCancelled() || generation !== refreshGenerationRef.current) return

        // Update MCP tools
        updateTools(mcpTools)

        // Update cached tool names for fast synchronous access
        updateMcpToolNames(mcpTools.map((t) => t.name))

        // Initialize default disabled tools for new users (only once)
        if (
          !isDefaultsInitialized() &&
          mcpTools.length > 0 &&
          mcpExtension?.getDefaultDisabledTools
        ) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (isCancelled() || generation !== refreshGenerationRef.current) return
          if (defaultDisabled.length > 0) {
            setDefaultDisabledTools(defaultDisabled)
            markDefaultsAsInitialized()
          }
        }
      } catch (error) {
        if (!isCancelled() && generation === refreshGenerationRef.current) {
          console.error('Failed to fetch MCP tools:', error)
        }
      }
    },
    [
      serviceHub,
      updateTools,
      updateMcpToolNames,
      isDefaultsInitialized,
      setDefaultDisabledTools,
      markDefaultsAsInitialized,
    ]
  )

  useEffect(() => {
    let unsubscribe = () => {}
    let unmounted = false
    const isCancelled = () => unmounted
    void refreshTools(isCancelled)

    const eventsService = serviceHub.events()
    if (eventsService) {
      eventsService
        .listen(SystemEvent.MCP_UPDATE, () => {
          void refreshTools(isCancelled)
        })
        .then((unsub) => {
          if (unmounted) {
            unsub()
            return
          }
          unsubscribe = unsub
        })
        .catch((error) => {
          if (!unmounted) {
            console.error('Failed to set up MCP update listener:', error)
          }
        })
    }
    return () => {
      unmounted = true
      refreshGenerationRef.current += 1
      unsubscribe()
    }
  }, [serviceHub, refreshTools])
}
