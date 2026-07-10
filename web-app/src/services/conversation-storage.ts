import { ExtensionManager } from '@/lib/extension'
import {
  type Thread,
  ConversationalExtension,
  ExtensionTypeEnum,
  ThreadMessage,
} from '@ax-studio/core'

export type ConversationalNativeApi = {
  listThreads: () => Promise<Thread[]>
  createThread: (payload: { thread: Partial<Thread> }) => Promise<Thread>
  modifyThread: (payload: { thread: Thread }) => Promise<void>
  deleteThread: (payload: { threadId: string }) => Promise<void>
  listMessages: (payload: { threadId: string }) => Promise<ThreadMessage[]>
  createMessage: (payload: { message: ThreadMessage }) => Promise<ThreadMessage>
  modifyMessage: (payload: { message: ThreadMessage }) => Promise<ThreadMessage>
  deleteMessage: (payload: { threadId: string; messageId: string }) => Promise<void>
}

export type ConversationalStorageMethods = Pick<
  ConversationalExtension,
  | 'listThreads'
  | 'createThread'
  | 'modifyThread'
  | 'deleteThread'
  | 'listMessages'
  | 'createMessage'
  | 'modifyMessage'
  | 'deleteMessage'
>

export type ConversationalStorageMethod = keyof ConversationalStorageMethods &
  keyof ConversationalNativeApi

export type ConversationalStorageMethodArgs<
  TMethod extends ConversationalStorageMethod
> = Parameters<ConversationalStorageMethods[TMethod]>

export type ConversationalNativeMethodArgs<
  TMethod extends ConversationalStorageMethod
> = Parameters<ConversationalNativeApi[TMethod]>

type ResolveStorageOperation<T> = Array<(() => Promise<T>) | undefined>

export const CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE =
  'Conversational storage is not available'

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
  return window.core?.api as ConversationalNativeApi | undefined
}

export function hasConversationalStorage(): boolean {
  return Boolean(getConversationalExtension() || getNativeApi())
}

export async function runConversationalStorageMethod<
  TMethod extends ConversationalStorageMethod,
>(
  method: TMethod,
  extensionArgs: ConversationalStorageMethodArgs<TMethod>,
  nativeArgs: ConversationalNativeMethodArgs<TMethod>,
  onFailure: (error: unknown) => void,
  unavailableMessage: string = CONVERSATIONAL_STORAGE_UNAVAILABLE_MESSAGE
): Promise<Awaited<ReturnType<ConversationalStorageMethods[TMethod]>>> {
  const extension = getConversationalExtension()
  const nativeApi = getNativeApi()

  const operations: ResolveStorageOperation<
    Awaited<ReturnType<ConversationalStorageMethods[TMethod]>>
  > = [
    resolveOperation(extension, method, extensionArgs),
    resolveOperation(nativeApi, method, nativeArgs),
  ]

  return runFirstSuccessful(operations, unavailableMessage, onFailure)
}

async function runFirstSuccessful<T>(
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

function resolveOperation<T>(
  provider: object | undefined,
  method: string,
  args: unknown[]
): (() => Promise<T>) | undefined {
  if (!provider) {
    return undefined
  }

  const operation = Reflect.get(provider, method) as unknown
  if (typeof operation !== 'function') {
    return undefined
  }

  return () => Promise.resolve(Reflect.apply(operation, provider, args) as T)
}
