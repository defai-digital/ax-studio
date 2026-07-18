import type { UIMessage } from '@ai-sdk/react'
import type { LanguageModelUsage } from 'ai'

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void

/**
 * Strip tool invocation parts from conversation history for tools that are no
 * longer in the active tools set.  This prevents the LLM from seeing prior
 * tool calls (e.g. fabric_search when local knowledge is toggled off) and
 * attempting to re-invoke them.
 */
export function stripUnavailableToolParts(
  messages: UIMessage[],
  availableToolNames: Set<string>
): UIMessage[] {
  // Fast path: when there are no tools at all we still want to strip, but when
  // there are no assistant messages with tool parts we can skip entirely.
  return messages.map((msg) => {
    if (msg.role !== 'assistant') return msg

    const filtered = msg.parts.filter((part) => {
      // Dynamic / legacy invocation parts carry the real name in toolName.
      if (part.type === 'dynamic-tool' || part.type === 'tool-invocation') {
        const toolName = (part as { toolName?: string }).toolName
        return typeof toolName === 'string' && availableToolNames.has(toolName)
      }
      // Typed AI SDK v5 tool parts: type is "tool-<toolName>"
      if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
        return availableToolNames.has(part.type.slice('tool-'.length))
      }
      return true
    })

    if (filtered.length === msg.parts.length) return msg
    // Keep a placeholder so the message isn't empty (preserves role alternation
    // which some providers require).
    if (filtered.length === 0) {
      return { ...msg, parts: [{ type: 'text' as const, text: '' }] }
    }
    return { ...msg, parts: filtered }
  })
}
