/**
 * Default Chat Organization Service - localStorage implementation
 */

import { ulid } from 'ulidx'
import type {
  ChatFolder,
  ChatOrganizationData,
  ChatOrganizationService,
  ChatTag,
} from './types'
import { localStorageKey } from '@/constants/localStorage'
import { chatOrganizationStorageSchema } from '@/schemas/chat-organization.schema'

const MAX_NAME_LENGTH = 200

function validateName(name: string, kind: 'Folder' | 'Tag'): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error(`${kind} name must not be empty`)
  if (trimmed.length > MAX_NAME_LENGTH)
    throw new Error(`${kind} name must be at most ${MAX_NAME_LENGTH} characters`)
  return trimmed
}

export class DefaultChatOrganizationService implements ChatOrganizationService {
  private storageKey = localStorageKey.chatOrganization
  private storageQueue: Promise<unknown> = Promise.resolve()

  private enqueueStorageTask<T>(task: () => T | Promise<T>): Promise<T> {
    const run = this.storageQueue.then(task, task)
    this.storageQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private loadFromStorage(): ChatOrganizationData {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (!stored) return { folders: [], tags: [] }
      const parsed = chatOrganizationStorageSchema.safeParse(JSON.parse(stored))
      if (!parsed.success) {
        console.warn(
          'Chat organization localStorage data did not match expected schema:',
          parsed.error.message
        )
        return { folders: [], tags: [] }
      }
      return {
        folders: (parsed.data.state?.folders ?? []) as ChatFolder[],
        tags: (parsed.data.state?.tags ?? []) as ChatTag[],
      }
    } catch (error) {
      console.error('Error loading chat organization from localStorage:', error)
      return { folders: [], tags: [] }
    }
  }

  private saveToStorage(data: ChatOrganizationData): void {
    try {
      const stored = {
        state: { folders: data.folders, tags: data.tags },
        version: 0,
      }
      localStorage.setItem(this.storageKey, JSON.stringify(stored))
    } catch (error) {
      console.error('Error saving chat organization to localStorage:', error)
      throw error
    }
  }

  async getOrganization(): Promise<ChatOrganizationData> {
    return this.enqueueStorageTask(() => this.loadFromStorage())
  }

  async addFolder(name: string): Promise<ChatFolder> {
    const trimmed = validateName(name, 'Folder')

    return this.enqueueStorageTask(() => {
      const newFolder: ChatFolder = {
        id: ulid(),
        name: trimmed,
        updatedAt: Date.now(),
      }

      const data = this.loadFromStorage()
      this.saveToStorage({ ...data, folders: [...data.folders, newFolder] })

      return newFolder
    })
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const trimmed = validateName(name, 'Folder')

    await this.enqueueStorageTask(() => {
      const data = this.loadFromStorage()
      const folders = data.folders.map((folder) =>
        folder.id === id
          ? { ...folder, name: trimmed, updatedAt: Date.now() }
          : folder
      )
      this.saveToStorage({ ...data, folders })
    })
  }

  async deleteFolder(id: string): Promise<void> {
    await this.enqueueStorageTask(() => {
      const data = this.loadFromStorage()
      this.saveToStorage({
        ...data,
        folders: data.folders.filter((folder) => folder.id !== id),
      })
    })
  }

  async addTag(name: string): Promise<ChatTag> {
    const trimmed = validateName(name, 'Tag')

    return this.enqueueStorageTask(() => {
      const data = this.loadFromStorage()
      if (
        data.tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())
      ) {
        throw new Error(`Tag "${trimmed}" already exists`)
      }

      const newTag: ChatTag = { id: ulid(), name: trimmed }
      this.saveToStorage({ ...data, tags: [...data.tags, newTag] })

      return newTag
    })
  }

  async renameTag(id: string, name: string): Promise<void> {
    const trimmed = validateName(name, 'Tag')

    await this.enqueueStorageTask(() => {
      const data = this.loadFromStorage()
      if (
        data.tags.some(
          (tag) =>
            tag.id !== id && tag.name.toLowerCase() === trimmed.toLowerCase()
        )
      ) {
        throw new Error(`Tag "${trimmed}" already exists`)
      }

      const tags = data.tags.map((tag) =>
        tag.id === id ? { ...tag, name: trimmed } : tag
      )
      this.saveToStorage({ ...data, tags })
    })
  }

  async deleteTag(id: string): Promise<void> {
    await this.enqueueStorageTask(() => {
      const data = this.loadFromStorage()
      this.saveToStorage({
        ...data,
        tags: data.tags.filter((tag) => tag.id !== id),
      })
    })
  }
}
