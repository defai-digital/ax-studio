/**
 * Default Messages Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import {
  ConversationalExtension,
  ExtensionTypeEnum,
  ThreadMessage,
} from '@ax-studio/core'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import type { MessagesService } from './types'

function getConversationalExtension(): ConversationalExtension | undefined {
  try {
    return ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    ) ?? undefined
  } catch (error) {
    console.warn('Conversational extension is unavailable:', error)
    return undefined
  }
}

function getNativeApi() {
  return window.core?.api
}

export class DefaultMessagesService implements MessagesService {
  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    const readers = [
      extension ? () => extension.listMessages(threadId) : undefined,
      nativeApi?.listMessages
        ? () => nativeApi.listMessages!({ threadId })
        : undefined,
    ].filter((reader): reader is () => Promise<ThreadMessage[]> => Boolean(reader))

    for (const readMessages of readers) {
      try {
        const messages = await readMessages()
        return Array.isArray(messages) ? messages : []
      } catch (error) {
        console.warn(`Failed to list messages for thread ${threadId}:`, error)
      }
    }

    return []
  }

  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't create messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    const writers = [
      extension
        ? (payload: ThreadMessage) => extension.createMessage(payload)
        : undefined,
      nativeApi?.createMessage
        ? (payload: ThreadMessage) => nativeApi.createMessage!({ message: payload })
        : undefined,
    ].filter((writer): writer is (payload: ThreadMessage) => Promise<ThreadMessage> => Boolean(writer))

    if (!writers.length) throw new Error('Conversational storage is not available')

    let lastError: unknown
    for (const createMessage of writers) {
      try {
        return await createMessage(message)
      } catch (error) {
        lastError = error
        console.warn(`Failed to create message for thread ${message.thread_id}:`, error)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to create message for thread ${message.thread_id}`)
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't modify messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    const writers = [
      extension
        ? (payload: ThreadMessage) => extension.modifyMessage(payload)
        : undefined,
      nativeApi?.modifyMessage
        ? (payload: ThreadMessage) => nativeApi.modifyMessage!({ message: payload })
        : undefined,
    ].filter((writer): writer is (payload: ThreadMessage) => Promise<ThreadMessage> => Boolean(writer))

    if (!writers.length) throw new Error('Conversational storage is not available')

    let lastError: unknown
    for (const modifyMessage of writers) {
      try {
        return await modifyMessage(message)
      } catch (error) {
        lastError = error
        console.warn(`Failed to modify message ${message.id}:`, error)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to modify message ${message.id}`)
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // Don't delete messages on server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    const deleters = [
      extension
        ? (id: string, msgId: string) => extension.deleteMessage(id, msgId)
        : undefined,
      nativeApi?.deleteMessage
        ? (id: string, msgId: string) => nativeApi.deleteMessage!({ threadId: id, messageId: msgId })
        : undefined,
    ].filter((deleter): deleter is (id: string, msgId: string) => Promise<void> => Boolean(deleter))

    if (!deleters.length) throw new Error('Conversational storage is not available')

    let lastError: unknown
    for (const deleteMessage of deleters) {
      try {
        await deleteMessage(threadId, messageId)
        return
      } catch (error) {
        lastError = error
        console.warn(`Failed to delete message ${messageId}:`, error)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to delete message ${messageId}`)
  }
}
