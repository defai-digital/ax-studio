/**
 * Default Threads Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import { ConversationalExtension, ExtensionTypeEnum } from '@ax-studio/core'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

/**
 * Rust's ThreadRecord expects whole-second i64 timestamps. Historical
 * frontend code paths (and legacy on-disk thread.json files) sometimes
 * produced `Date.now() / 1000` with fractional seconds, which Tauri's
 * IPC deserializer rejects outright ("invalid type: floating point ...,
 * expected i64"). Sanitize defensively here so every call — regardless
 * of caller — ends up with a safe integer.
 */
const toWholeSeconds = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  // Detect values that are in ms (> year 33658) and downshift to seconds.
  const seconds = value > 1e12 ? value / 1000 : value
  return Math.floor(seconds)
}

const normalizeThreadTimestamps = <T extends { created?: unknown; updated?: unknown }>(
  thread: T
): T => {
  const created = toWholeSeconds((thread as { created?: unknown }).created)
  const updated =
    toWholeSeconds((thread as { updated?: unknown }).updated) ??
    Math.floor(Date.now() / 1000)
  return {
    ...thread,
    ...(created !== undefined ? { created } : {}),
    updated,
  }
}

export class DefaultThreadsService implements ThreadsService {
  async fetchThreads(): Promise<Thread[]> {
    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.listThreads()
        .then((threads) => {
          if (!Array.isArray(threads)) return []

          // Filter out temporary threads from the list
          const filteredThreads = threads.filter(
            (e) => e.id !== TEMPORARY_CHAT_ID
          )

          return filteredThreads.map((e) => {
            // Model is always stored in assistants[0].model
            const model = e.assistants?.[0]?.model
              ? {
                  id: e.assistants[0].model.id,
                  provider: e.assistants[0].model.engine,
                }
              : undefined

            // Check if this is a "real" assistant (has instructions) or just model storage
            const assistants = e.assistants

            return {
              ...e,
              updated:
                typeof e.updated === 'number' && e.updated > 1e12
                  ? Math.floor(e.updated / 1000)
                  : (e.updated ?? 0),
              order: e.metadata?.order,
              isFavorite: e.metadata?.is_favorite,
              model,
              assistants,
              metadata: {
                ...e.metadata,
                // Override extracted fields to avoid duplication
                order: e.metadata?.order,
                is_favorite: e.metadata?.is_favorite,
              },
            } as Thread
          })
        })
        ?.catch((e) => {
          console.error('Error fetching threads:', e)
          return [] // Fallback: empty thread list allows app to load
        }) ?? []
    )
  }

  async createThread(thread: Thread): Promise<Thread> {
    // For temporary threads, bypass the conversational extension (in-memory only)
    if (thread.id === TEMPORARY_CHAT_ID) {
      return thread
    }

    // Build assistants payload - always include model info
    // If there's a real assistant (with instructions), include full assistant data
    // Otherwise, just include minimal model-only entry for storage
    const hasRealAssistant = thread.assistants && thread.assistants.length > 0
    const assistantsPayload = hasRealAssistant
      ? [
          {
            ...thread.assistants[0],
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'ax-studio',
            },
          },
        ]
      : [
          {
            // Minimal entry just to store model info
            id: 'model-only',
            name: 'Model',
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'ax-studio',
            },
          },
        ]

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    if (!extension) return thread

    try {
      const e = await extension.createThread(
        normalizeThreadTimestamps({
          ...thread,
          assistants: assistantsPayload,
          metadata: {
            ...thread.metadata,
            order: thread.order,
          },
        })
      )

      // Model is always stored in assistants[0].model
      const model = e.assistants?.[0]?.model
        ? {
            id: e.assistants[0].model.id,
            provider: e.assistants[0].model.engine,
          }
        : thread.model

      const assistants = e.assistants

      return {
        ...e,
        updated: e.updated,
        model,
        order: e.metadata?.order ?? thread.order,
        assistants,
      } as Thread
    } catch (error) {
      console.error(`Failed to create thread ${thread.id}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to create thread ${thread.id}`)
    }
  }

  async updateThread(thread: Thread): Promise<void> {
    // For temporary threads, skip updating via conversational extension
    if (thread.id === TEMPORARY_CHAT_ID) {
      return
    }

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    if (!extension) {
      // Previously optional-chained, so renames/favourites silently
      // "succeeded" but never reached storage — on the next app reload
      // the old title/favourite flag would reappear. Throw so callers
      // can surface the failure.
      throw new Error('Conversational extension not available')
    }

    try {
      await extension.modifyThread(normalizeThreadTimestamps({
        ...thread,
        assistants: thread.assistants?.map((e) => {
          return {
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'ax-studio',
            },
            id: e.id,
            name: e.name,
            instructions: e.instructions,
            tools: e.tools ?? [],
          }
        }) ?? [
          {
            model: {
              id: thread.model?.id ?? '*',
              engine: thread.model?.provider ?? 'ax-studio',
            },
            id: 'ax-studio',
            name: 'Ax-Studio',
            instructions: '',
            tools: [],
          },
        ],
        metadata: {
          ...thread.metadata,
          is_favorite: thread.isFavorite,
          order: thread.order,
        },
        object: 'thread',
        created: Math.floor(Date.now() / 1000),
        updated: Math.floor(Date.now() / 1000),
      }))
    } catch (error) {
      console.error(`Failed to update thread ${thread.id}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to update thread ${thread.id}`)
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    // For temporary threads, skip deleting via conversational extension
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    if (!extension) {
      // Previously optional-chained and silently no-oped, leaving the
      // thread on disk. Throw so the caller can roll the delete back.
      throw new Error('Conversational extension not available')
    }

    try {
      await extension.deleteThread(threadId)
    } catch (error) {
      console.error(`Failed to delete thread ${threadId}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to delete thread ${threadId}`)
    }
  }
}
