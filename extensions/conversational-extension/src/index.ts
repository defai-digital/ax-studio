import {
  ConversationalExtension,
  Thread,
  ThreadAssistantInfo,
  ThreadMessage,
} from '@ax-studio/core'

/**
 * AxStudioConversationalExtension is a ConversationalExtension implementation that provides
 * functionality for managing threads.
 */
export default class AxStudioConversationalExtension extends ConversationalExtension {
  private getCoreApi() {
    const api = window.core?.api
    if (!api) {
      throw new Error('Core API not initialized')
    }
    return api
  }

  private async callApi<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Conversational extension ${operation} failed: ${message}`)
    }
  }

  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    // no-opt
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload() {}

  /**
   * Returns a Promise that resolves to an array of Conversation objects.
   */
  async listThreads(): Promise<Thread[]> {
    const api = this.getCoreApi()
    return this.callApi('listThreads', () => api.listThreads())
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async createThread(thread: Thread): Promise<Thread> {
    const api = this.getCoreApi()
    return this.callApi('createThread', () => api.createThread({ thread }))
  }

  /**
   * Saves a Thread object to a json file.
   * @param thread The Thread object to save.
   */
  async modifyThread(thread: Thread): Promise<void> {
    const api = this.getCoreApi()
    return this.callApi('modifyThread', () => api.modifyThread({ thread }))
  }

  /**
   * Delete a thread with the specified ID.
   * @param threadId The ID of the thread to delete.
   */
  async deleteThread(threadId: string): Promise<void> {
    const api = this.getCoreApi()
    return this.callApi('deleteThread', () => api.deleteThread({ threadId }))
  }

  /**
   * Adds a new message to a specified thread.
   * @param message The ThreadMessage object to be added.
   * @returns A Promise that resolves when the message has been added.
   */
  async createMessage(message: ThreadMessage): Promise<ThreadMessage> {
    const api = this.getCoreApi()
    return this.callApi('createMessage', () => api.createMessage({ message }))
  }

  /**
   * Modifies a message in a thread.
   * @param message
   * @returns
   */
  async modifyMessage(message: ThreadMessage): Promise<ThreadMessage> {
    const api = this.getCoreApi()
    return this.callApi('modifyMessage', () => api.modifyMessage({ message }))
  }

  /**
   * Deletes a specific message from a thread.
   * @param threadId The ID of the thread containing the message.
   * @param messageId The ID of the message to be deleted.
   * @returns A Promise that resolves when the message has been successfully deleted.
   */
  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const api = this.getCoreApi()
    return this.callApi('deleteMessage', () =>
      api.deleteMessage({ threadId, messageId })
    )
  }

  /**
   * Retrieves all messages for a specified thread.
   * @param threadId The ID of the thread to get messages from.
   * @returns A Promise that resolves to an array of ThreadMessage objects.
   */
  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    const api = this.getCoreApi()
    return this.callApi('listMessages', () => api.listMessages({ threadId }))
  }

  /**
   * Retrieves the assistant information for a specified thread.
   * @param threadId The ID of the thread for which to retrieve assistant information.
   * @returns A Promise that resolves to a ThreadAssistantInfo object containing
   * the details of the assistant associated with the specified thread.
   */
  async getThreadAssistant(threadId: string): Promise<ThreadAssistantInfo> {
    const api = this.getCoreApi()
    return this.callApi('getThreadAssistant', () =>
      api.getThreadAssistant({ threadId })
    )
  }
  /**
   * Creates a new assistant for the specified thread.
   * @param threadId The ID of the thread for which the assistant is being created.
   * @param assistant The information about the assistant to be created.
   * @returns A Promise that resolves to the newly created ThreadAssistantInfo object.
   */
  async createThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    const api = this.getCoreApi()
    return this.callApi('createThreadAssistant', () =>
      api.createThreadAssistant({ threadId, assistant })
    )
  }

  /**
   * Modifies an existing assistant for the specified thread.
   * @param threadId The ID of the thread for which the assistant is being modified.
   * @param assistant The updated information for the assistant.
   * @returns A Promise that resolves to the updated ThreadAssistantInfo object.
   */
  async modifyThreadAssistant(
    threadId: string,
    assistant: ThreadAssistantInfo
  ): Promise<ThreadAssistantInfo> {
    const api = this.getCoreApi()
    return this.callApi('modifyThreadAssistant', () =>
      api.modifyThreadAssistant({ threadId, assistant })
    )
  }
}
