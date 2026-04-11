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

export class DefaultMessagesService implements MessagesService {
  async fetchMessages(threadId: string): Promise<ThreadMessage[]> {
    // Don't fetch messages from server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return []
    }

    return (
      ExtensionManager.getInstance()
        .get<ConversationalExtension>(ExtensionTypeEnum.Conversational)
        ?.listMessages(threadId)
        ?.catch((error) => {
          console.warn(
            `Failed to list messages for thread ${threadId}:`,
            error
          )
          return []
        }) ?? []
    )
  }

  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't create messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    if (!extension) return message

    try {
      return await extension.createMessage(message)
    } catch (error) {
      console.error(
        `Failed to create message for thread ${message.thread_id}:`,
        error
      )
      throw error instanceof Error
        ? error
        : new Error(`Failed to create message for thread ${message.thread_id}`)
    }
  }

  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    // Don't modify messages on server for temporary chat - it's local only
    if (message.thread_id === TEMPORARY_CHAT_ID) {
      return message
    }

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    if (!extension) return message

    try {
      return await extension.modifyMessage(message)
    } catch (error) {
      console.error(`Failed to modify message ${message.id}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to modify message ${message.id}`)
    }
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    // Don't delete messages on server for temporary chat - it's local only
    if (threadId === TEMPORARY_CHAT_ID) {
      return
    }

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    if (!extension) {
      // Previously used optional chaining and silently succeeded — the UI
      // would show the message removed while storage still held it. Throw
      // instead so the caller can roll the optimistic delete back.
      throw new Error('Conversational extension not available')
    }

    try {
      await extension.deleteMessage(threadId, messageId)
    } catch (error) {
      console.error(`Failed to delete message ${messageId}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to delete message ${messageId}`)
    }
  }
}
