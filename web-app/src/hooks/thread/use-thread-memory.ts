/**
 * useThreadMemory — encapsulates memory state, processing, and commands for a thread.
 *
 * Responsibilities:
 * - Compute memorySuffix (system prompt suffix) from stored memories
 * - Track processed message IDs to avoid double-processing (ref)
 * - Capture the last user input at submit time (ref) for pattern fallback
 * - Strip memory tags from content parts and apply LLM delta ops on finish
 * - Handle /remember and /forget slash commands
 */
import { useCallback, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { type UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import { useMemory } from '@/hooks/useMemory'
import {
  parseMemoryDelta,
  applyMemoryDelta,
  buildMemoryContext,
  extractFactsFromPatterns,
  mergePatternFacts,
  type MemoryDeltaOp,
} from '@/lib/memory-extractor'
import { type ThreadMessage } from '@ax-studio/core'

export function useThreadMemory(threadId: string) {
  const isMemoryEnabledForThread = useMemory((state) => state.isMemoryEnabledForThread)
  const globalMemoryEnabled = useMemory((state) => state.memoryEnabled)
  const memoryEnabledPerThread = useMemory((state) => state.memoryEnabledPerThread)
  const defaultMemories = useMemory(useShallow((state) => state.memories['default'] || []))

  const memoryEnabled = threadId in memoryEnabledPerThread
    ? memoryEnabledPerThread[threadId]
    : globalMemoryEnabled

  // Memoized system prompt suffix — rebuilds when memory is toggled or memories change
  const memorySuffix = useMemo(() => {
    if (!memoryEnabled) return ''
    return buildMemoryContext(defaultMemories)
  }, [memoryEnabled, defaultMemories])

  // Ref-based dedup: tracks assistant message IDs whose memory has been processed.
  // More reliable than store-based checks (avoids timing races with onFinish
  // being called multiple times for the same message).
  const processedMemoryMsgIds = useRef(new Set<string>())

  // Captured at submit time so onFinish can read the user's text without
  // stale-closure issues (the closure over onFinish would otherwise see an
  // outdated value).
  const lastUserInputRef = useRef('')

  /**
   * Process memory tags and persist memories after an assistant message finishes.
   *
   * Called from the useChat `onFinish` callback when `!isAbort && message.role === 'assistant'`.
   * The caller is responsible for the isAbort / role guard; this function receives the
   * already-extracted contentParts and mutates them in place (strips <memory_extract> tags).
   */
  const processMemoryOnFinish = useCallback(
    (
      message: UIMessage,
      contentParts: ThreadMessage['content'],
      setChatMessages: (msgs: UIMessage[]) => void
    ) => {
      // Ref-based dedup — store-based check is unreliable (timing issues)
      const isNewMessage = !processedMemoryMsgIds.current.has(message.id)
      if (isNewMessage) processedMemoryMsgIds.current.add(message.id)

      // Strip memory tags + collect LLM delta ops from all content parts
      const allOps: MemoryDeltaOp[] = []
      for (const part of contentParts) {
        if (part.type === 'text' && part.text?.value) {
          const { ops, cleanedText } = parseMemoryDelta(part.text.value)
          part.text.value = cleanedText
          if (isNewMessage) allOps.push(...ops)
        }
      }

      if (isNewMessage && useMemory.getState().isMemoryEnabledForThread(threadId) && contentParts.length > 0) {
        let toasted = false

        // Step 1: Apply LLM delta ops (surgical add/update/delete)
        if (allOps.length > 0) {
          const existing = useMemory.getState().getMemories('default')
          const updated = applyMemoryDelta(existing, allOps, threadId)
          useMemory.getState().importMemories('default', updated)
          const added = allOps.filter((o) => o.op === 'add').length
          const changed = allOps.filter((o) => o.op === 'update' || o.op === 'delete').length
          if (added > 0) {
            toast.success(`Remembered ${added} new fact${added !== 1 ? 's' : ''}`)
            toasted = true
          } else if (changed > 0) {
            toast.info('Updated memories')
            toasted = true
          }
        }

        // Step 2: Pattern fallback — use ref captured at submit time (no stale-closure issues).
        // mergePatternFacts deduplicates by category, so no duplicates from Step 1.
        // Always saves to also correct wrong LLM-written facts (e.g. name="vegetarian" → "Alex").
        const userText = lastUserInputRef.current
        if (userText) {
          const patternFacts = extractFactsFromPatterns(userText)
          if (patternFacts.size > 0) {
            const currentMems = useMemory.getState().getMemories('default')
            const merged = mergePatternFacts(currentMems, patternFacts, threadId)
            const newlyAdded = merged.length - currentMems.length
            useMemory.getState().importMemories('default', merged)
            if (newlyAdded > 0 && !toasted)
              toast.success(`Remembered ${newlyAdded} new fact${newlyAdded !== 1 ? 's' : ''}`)
          }
        }
      }

      // Strip memory_extract tags from the live UI chat messages
      if (useMemory.getState().isMemoryEnabledForThread(threadId)) {
        const sessions = useChatSessions.getState().sessions[threadId]
        if (sessions?.chat.messages) {
          const cleaned = sessions.chat.messages.map((msg) => {
            if (msg.id !== message.id || msg.role !== 'assistant') return msg
            return {
              ...msg,
              parts: msg.parts.map((part) => {
                if (part.type !== 'text') return part
                const stripped = (part as { type: 'text'; text: string }).text
                  .replace(/<memory_extract>[\s\S]*?<\/memory_extract>/, '')
                  .trimEnd()
                return { ...part, text: stripped }
              }),
            }
          })
          setChatMessages(cleaned)
        }
      }
    },
    [threadId]
  )

  /**
   * Handle the `/remember <fact>` slash command.
   * Returns `true` if the command was consumed so the caller can early-return.
   */
  const handleRememberCommand = useCallback(
    (text: string): boolean => {
      if (!text.startsWith('/remember ')) return false
      const fact = text.slice('/remember '.length).trim()
      if (fact) {
        const now = Date.now()
        useMemory.getState().addMemories('default', [
          {
            id: `mem-${now}-manual`,
            fact,
            category: 'manual',
            sourceThreadId: threadId,
            createdAt: now,
            updatedAt: now,
          },
        ])
        toast.success(`Remembered: "${fact}"`)
      }
      return true
    },
    [threadId]
  )

  /**
   * Handle the `/forget <query>` slash command.
   * Returns `true` if the command was consumed so the caller can early-return.
   */
  const handleForgetCommand = useCallback(
    (text: string): boolean => {
      if (!text.startsWith('/forget ')) return false
      const query = text.slice('/forget '.length).trim().toLowerCase()
      if (query) {
        const memories = useMemory.getState().getMemories('default')
        const match = memories.find((m) => m.fact.toLowerCase().includes(query))
        if (match) {
          useMemory.getState().deleteMemory('default', match.id)
          toast.success(`Forgot: "${match.fact}"`)
        } else {
          toast.info(`No memory found matching "${query}"`)
        }
      }
      return true
    },
    []
  )

  return {
    memorySuffix,
    processedMemoryMsgIds,
    lastUserInputRef,
    processMemoryOnFinish,
    handleRememberCommand,
    handleForgetCommand,
  }
}
