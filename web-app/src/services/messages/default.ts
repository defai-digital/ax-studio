/**
 * Default Messages Service - Web implementation
 */

import { ThreadMessage } from '@ax-studio/core'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { runConversationalStorageMethod } from '../conversation-storage'
import type { MessagesService } from './types'

export class DefaultMessagesService implements MessagesService {
  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    try {
      const messages = await runConversationalStorageMethod(
        'listMessages',
        [threadId],
        [{ threadId }],
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

    return runConversationalStorageMethod(
      'createMessage',
      [message],
      [{ message }],
      (error) => console.warn(`Failed to create message for thread ${message.thread_id}:`, error)
    )
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't modify messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    return runConversationalStorageMethod(
      'modifyMessage',
      [message],
      [{ message }],
      (error) => console.warn(`Failed to modify message ${message.id}:`, error)
    )
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // Don't delete messages on server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    await runConversationalStorageMethod(
      'deleteMessage',
      [threadId, messageId],
      [{ threadId, messageId }],
      (error) => console.warn(`Failed to delete message ${messageId}:`, error)
    )
  }
}
