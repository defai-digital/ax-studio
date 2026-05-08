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

    const extension = ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    )
    const listMessages = extension
      ? (id: string) => extension.listMessages(id)
      : window.core?.api?.listMessages
        ? (id: string) => window.core!.api!.listMessages({ threadId: id })
        : undefined

    if (!listMessages) return []

    return (
      listMessages(threadId)
        ?.catch((error: unknown) => {
          console.warn(
            `Failed to list messages for thread ${threadId}:`,
            error
          )
          return []
        })
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
    const createMessage = extension
      ? (payload: Partial<ThreadMessage>) => extension.createMessage(payload)
      : window.core?.api?.createMessage
        ? (payload: Partial<ThreadMessage>) => window.core!.api!.createMessage({ message: payload })
        : undefined

    if (!createMessage) throw new Error('Conversational storage is not available')

    try {
      return await createMessage(message)
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
    const modifyMessage = extension
      ? (payload: ThreadMessage) => extension.modifyMessage(payload)
      : window.core?.api?.modifyMessage
        ? (payload: ThreadMessage) => window.core!.api!.modifyMessage({ message: payload })
        : undefined

    if (!modifyMessage) throw new Error('Conversational storage is not available')

    try {
      return await modifyMessage(message)
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
    const deleteMessage = extension
      ? (threadId: string, messageId: string) => extension.deleteMessage(threadId, messageId)
      : window.core?.api?.deleteMessage
        ? (threadId: string, messageId: string) => window.core!.api!.deleteMessage({ threadId, messageId })
        : undefined

    if (!deleteMessage) throw new Error('Conversational storage is not available')

    try {
      await deleteMessage(threadId, messageId)
    } catch (error) {
      console.error(`Failed to delete message ${messageId}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to delete message ${messageId}`)
    }
  }
}
