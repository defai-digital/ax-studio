/**
 * Default Messages Service - Web implementation
 */

import { ThreadMessage } from '@ax-studio/core'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  type ConversationalStorageMethod,
  CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE,
  runConversationalStorageMethod,
  type ConversationalNativeMethodArgs,
  type ConversationalStorageMethodArgs,
} from '../conversation-storage'
import type { MessagesService } from './types'

type MessageStorageMethod = Extract<
  ConversationalStorageMethod,
  'listMessages' | 'createMessage' | 'modifyMessage' | 'deleteMessage'
>

export class DefaultMessagesService implements MessagesService {
  private runMessageStorage<TMethod extends MessageStorageMethod>(
    method: TMethod,
    extensionArgs: ConversationalStorageMethodArgs<TMethod>,
    nativeArgs: ConversationalNativeMethodArgs<TMethod>,
    onFailure: (error: unknown) => void
  ) {
    return runConversationalStorageMethod(
      method,
      extensionArgs,
      nativeArgs,
      onFailure,
      CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE
    )
  }

  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    try {
      const messages = await this.runMessageStorage(
        'listMessages',
        [threadId],
        [{ threadId }],
        (error) => console.warn(`Failed to list messages for thread ${threadId}:`, error),
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

    return this.runMessageStorage(
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

    return this.runMessageStorage(
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

    await this.runMessageStorage(
      'deleteMessage',
      [threadId, messageId],
      [{ threadId, messageId }],
      (error) => console.warn(`Failed to delete message ${messageId}:`, error)
    )
  }
}
