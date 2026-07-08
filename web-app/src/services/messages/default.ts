/**
 * Default Messages Service - Web implementation
 */

import { ThreadMessage } from '@ax-studio/core'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  getConversationalExtension,
  getNativeApi,
  runConversationalStorage,
} from '../conversation-storage'
import type { MessagesService } from './types'

export class DefaultMessagesService implements MessagesService {
  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    try {
      const messages = await runConversationalStorage<ThreadMessage[]>(
        {
          extension: getConversationalExtension()?.listMessages
            ? (extension) => extension.listMessages(threadId)
            : undefined,
          native: getNativeApi()?.listMessages
            ? (nativeApi) =>
                nativeApi.listMessages!({ threadId }) as Promise<ThreadMessage[]>
            : undefined,
        },
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

    return runConversationalStorage(
      {
        extension: getConversationalExtension()?.createMessage
          ? (extension) => extension.createMessage(message)
          : undefined,
        native: getNativeApi()?.createMessage
          ? (nativeApi) =>
              nativeApi.createMessage!({ message }) as Promise<ThreadMessage>
          : undefined,
      },
      'Conversational storage is not available',
      (error) => console.warn(`Failed to create message for thread ${message.thread_id}:`, error)
    )
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't modify messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    return runConversationalStorage(
      {
        extension: getConversationalExtension()?.modifyMessage
          ? (extension) => extension.modifyMessage(message)
          : undefined,
        native: getNativeApi()?.modifyMessage
          ? (nativeApi) =>
              nativeApi.modifyMessage!({ message }) as Promise<ThreadMessage>
          : undefined,
      },
      'Conversational storage is not available',
      (error) => console.warn(`Failed to modify message ${message.id}:`, error)
    )
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // Don't delete messages on server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await runConversationalStorage(
      {
        extension: getConversationalExtension()?.deleteMessage
          ? (extension) => extension.deleteMessage(threadId, messageId)
          : undefined,
        native: getNativeApi()?.deleteMessage
          ? (nativeApi) =>
              nativeApi.deleteMessage!({ threadId, messageId }) as Promise<void>
          : undefined,
      },
      'Conversational storage is not available',
      (error) => console.warn(`Failed to delete message ${messageId}:`, error)
    )
  }
}
