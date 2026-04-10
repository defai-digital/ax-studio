/**
 * Default Assistants Service - Web implementation
 */

import { ExtensionManager } from '@/lib/extension'
import { Assistant, AssistantExtension, ExtensionTypeEnum } from '@ax-studio/core'
import type { AssistantsService } from './types'

export class DefaultAssistantsService implements AssistantsService {
  async getAssistants(): Promise<Assistant[] | null> {
    const extension = ExtensionManager.getInstance().get<AssistantExtension>(
      ExtensionTypeEnum.Assistant
    )

    if (!extension) {
      console.warn('AssistantExtension not found')
      return null
    }

    return extension.getAssistants()
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const extension = ExtensionManager.getInstance().get<AssistantExtension>(
      ExtensionTypeEnum.Assistant
    )
    if (!extension) {
      // Previously optional-chained, so the assistant existed only in
      // in-memory state — the next reload would lose it silently. Throw
      // so the caller can show a real error.
      throw new Error('Assistant extension not available')
    }
    try {
      await extension.createAssistant(assistant)
    } catch (error) {
      console.error(`Failed to create assistant ${assistant.id}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to create assistant ${assistant.id}`)
    }
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    const extension = ExtensionManager.getInstance().get<AssistantExtension>(
      ExtensionTypeEnum.Assistant
    )
    if (!extension) {
      throw new Error('Assistant extension not available')
    }
    try {
      await extension.deleteAssistant(assistant)
    } catch (error) {
      console.error(`Failed to delete assistant ${assistant.id}:`, error)
      throw error instanceof Error
        ? error
        : new Error(`Failed to delete assistant ${assistant.id}`)
    }
  }
}
