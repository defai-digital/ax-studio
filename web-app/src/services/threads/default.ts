/**
 * Default Threads Service - Web implementation
 */

import { type Thread as CoreThread } from '@ax-studio/core'
import type { ThreadsService } from './types'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  hasConversationalStorage,
  runConversationalStorage,
} from '../conversation-storage'

export class DefaultThreadsService implements ThreadsService {
  async fetchThreads(): Promise<Thread[]> {
    let listThreads = getListThreads()

    for (let attempt = 0; !listThreads && attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      listThreads = getListThreads()
    }

    if (!listThreads) return []

    try {
      const threads = await listThreads()
      if (!Array.isArray(threads)) return []

      return threads
        .filter((thread) => thread.id !== TEMPORARY_CHAT_ID)
        .map(normalizeStoredThread)
    } catch (e) {
      console.error('Error fetching threads:', e)
      return [] // Fallback: empty thread list allows app to load
    }
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
            model: buildStoredModelRef(thread),
          },
        ]
      : [
          {
            // Minimal entry just to store model info
            id: 'model-only',
            name: 'Model',
            model: buildStoredModelRef(thread),
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

    const e = await runConversationalStorage(
      'createThread',
      [payload],
      [{ thread: payload }],
      (error) => console.warn(`Failed to create thread ${thread.id}:`, error)
    )

    const model = normalizeThreadModelFromStorage(e, thread.model)

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
          model: buildStoredModelRef(thread),
          id: e.id,
          name: e.name,
          instructions: e.instructions,
          tools: e.tools ?? [],
        }
      }) ?? [
        {
          model: buildStoredModelRef(thread),
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

    await runConversationalStorage(
      'modifyThread',
      [payload],
      [{ thread: payload }],
      (error) => console.warn(`Failed to update thread ${thread.id}:`, error)
    )
  }

  async deleteThread(threadId: string): Promise<void> {
    // For temporary threads, skip deleting via conversational extension
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await runConversationalStorage(
      'deleteThread',
      [threadId],
      [{ threadId }],
      (error) => console.warn(`Failed to delete thread ${threadId}:`, error)
    )
  }
}

function normalizeStoredThread(thread: CoreThread): Thread {
  const model = normalizeThreadModelFromStorage(thread)
  return {
    ...thread,
    updated:
      typeof thread.updated === 'number' && thread.updated > 1e12
        ? Math.floor(thread.updated / 1000)
        : (thread.updated ?? 0),
    order: thread.metadata?.order,
    isFavorite: thread.metadata?.is_favorite,
    model,
    metadata: {
      ...thread.metadata,
      order: thread.metadata?.order,
      is_favorite: thread.metadata?.is_favorite,
    },
  }
}

function normalizeThreadModelFromStorage(
  thread: Pick<CoreThread, 'assistants'>,
  fallbackModel?: Thread['model']
): Thread['model'] {
  const storedModel = thread.assistants?.[0]?.model
  return storedModel
    ? {
      id: storedModel.id,
      provider: storedModel.engine,
    }
    : fallbackModel
}

function buildStoredModelRef(thread: Thread): { id: string; engine: string } {
  return {
    id: thread.model?.id ?? '*',
    engine: thread.model?.provider ?? 'ax-studio',
  }
}

function getListThreads(): (() => Promise<CoreThread[]>) | undefined {
  if (!hasConversationalStorage()) {
    return undefined
  }

  return () =>
    runConversationalStorage(
      'listThreads',
      [],
      [],
      (error) => console.warn('Failed to list threads:', error),
    )
}
