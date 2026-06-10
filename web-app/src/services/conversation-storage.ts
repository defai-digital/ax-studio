import { ExtensionManager } from '@/lib/extension'
import {
  ConversationalExtension,
  ExtensionTypeEnum,
} from '@ax-studio/core'

export function getConversationalExtension(): ConversationalExtension | undefined {
  try {
    return ExtensionManager.getInstance().get<ConversationalExtension>(
      ExtensionTypeEnum.Conversational
    ) ?? undefined
  } catch (error) {
    console.warn('Conversational extension is unavailable:', error)
    return undefined
  }
}

export function getNativeApi() {
  return window.core?.api
}

export async function runFirstSuccessful<T>(
  operations: Array<(() => Promise<T>) | undefined>,
  unavailableMessage: string,
  onFailure: (error: unknown) => void
): Promise<T> {
  const availableOperations = operations.filter(
    (operation): operation is () => Promise<T> => Boolean(operation)
  )

  if (!availableOperations.length) {
    throw new Error(unavailableMessage)
  }

  let lastError: unknown
  for (const operation of availableOperations) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      onFailure(error)
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(unavailableMessage)
}
