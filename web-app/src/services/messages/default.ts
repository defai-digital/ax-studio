/**
 * Default Messages Service - Web implementation
 */

import { ThreadMessage } from '@ax-studio/core'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  getConversationalExtension,
  getNativeApi,
  runFirstSuccessful,
} from '../conversation-storage'
import type { MessagesService } from './types'

export class DefaultMessagesService implements MessagesService {
  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    try {
      const messages = await runFirstSuccessful(
        [
          extension ? () => extension.listMessages(threadId) : undefined,
          nativeApi?.listMessages
            ? () => nativeApi.listMessages!({ threadId }) as Promise<ThreadMessage[]>
            : undefined,
        ],
        'Conversational storage is not available',
        (error) => console.warn(`Failed to list messages for thread ${threadId}:`, error)
      )
      return Array.isArray(messages) ? messages : []
    } catch {
      return []
    }
  }

  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't create messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    return runFirstSuccessful(
      [
        extension
          ? () => extension.createMessage(message)
          : undefined,
        nativeApi?.createMessage
          ? () => nativeApi.createMessage!({ message }) as Promise<ThreadMessage>
          : undefined,
      ],
      'Conversational storage is not available',
      (error) => console.warn(`Failed to create message for thread ${message.thread_id}:`, error)
    )
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't modify messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    return runFirstSuccessful(
      [
        extension
          ? () => extension.modifyMessage(message)
          : undefined,
        nativeApi?.modifyMessage
          ? () => nativeApi.modifyMessage!({ message }) as Promise<ThreadMessage>
          : undefined,
      ],
      'Conversational storage is not available',
      (error) => console.warn(`Failed to modify message ${message.id}:`, error)
    )
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // Don't delete messages on server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    const extension = getConversationalExtension()
    const nativeApi = getNativeApi()
    await runFirstSuccessful(
      [
        extension
          ? () => extension.deleteMessage(threadId, messageId)
          : undefined,
        nativeApi?.deleteMessage
          ? () => nativeApi.deleteMessage!({ threadId, messageId }) as Promise<void>
          : undefined,
      ],
      'Conversational storage is not available',
      (error) => console.warn(`Failed to delete message ${messageId}:`, error)
    )
  }
}
