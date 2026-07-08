/**
 * Default Threads Service - Web implementation
 */

import { type Thread as CoreThread } from '@ax-studio/core'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE,
  hasConversationalStorage,
  runConversationalStorageMethod,
} from '../conversation-storage'

export class DefaultThreadsService implements ThreadsService {
  async fetchThreads(): Promise<Thread[]> {
    let listThreads = getListThreads()

    for (let attempt = 0; !listThreads && attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      listThreads = getListThreads()
    }

    if (!listThreads) return []

    return (
      listThreads()
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
        })
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
    const firstAssistant = thread.assistants?.[0]
    const hasRealAssistant = Boolean(firstAssistant)
    const assistantsPayload = hasRealAssistant
      ? [
          {
            ...firstAssistant,
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

    const payload = {
      ...thread,
      assistants: assistantsPayload,
      metadata: {
        ...thread.metadata,
        order: thread.order,
      },
    } as Partial<CoreThread>

    const e = await runConversationalStorageMethod(
      'createThread',
      [payload],
      [{ thread: payload }],
      (error) => console.warn(`Failed to create thread ${thread.id}:`, error),
      CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE
    )

    const model = e.assistants?.[0]?.model
      ? {
          id: e.assistants[0].model.id,
          provider: e.assistants[0].model.engine,
        }
      : thread.model

    return {
      ...e,
      updated: e.updated,
      model,
      order: e.metadata?.order ?? thread.order,
      assistants: e.assistants,
    } as Thread
  }

  async updateThread(thread: Thread): Promise<void> {
    // For temporary threads, skip updating via conversational extension
    if (thread.id === TEMPORARY_CHAT_ID) {
      return
    }

    const payload = {
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
          name: 'AX Studio',
          instructions: '',
          tools: [],
        },
      ],
      metadata: {
        ...thread.metadata,
        is_favorite: thread.isFavorite,
        order: thread.order,
      },
      created: thread.created ?? Math.floor(Date.now() / 1000),
      updated: Math.floor(Date.now() / 1000),
    } as CoreThread

    await runConversationalStorageMethod(
      'modifyThread',
      [payload],
      [{ thread: payload }],
      (error) => console.warn(`Failed to update thread ${thread.id}:`, error),
      CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE
    )
  }

  async deleteThread(threadId: string): Promise<void> {
    // For temporary threads, skip deleting via conversational extension
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await runConversationalStorageMethod(
      'deleteThread',
      [threadId],
      [{ threadId }],
      (error) => console.warn(`Failed to delete thread ${threadId}:`, error),
      CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE
    )
  }
}

function getListThreads(): (() => Promise<CoreThread[]>) | undefined {
  if (!hasConversationalStorage()) {
    return undefined
  }

  return () =>
    runConversationalStorageMethod(
      'listThreads',
      [],
      [],
      (error) => console.warn('Failed to list threads:', error),
      CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE
    )
}
