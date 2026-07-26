/**
 * Chat organization persistence — localStorage-backed folders & tags.
 *
 * Folded in from the retired `services/chat-organization` ServiceHub service
 * (the service layer was pruned in the Electron migration; folders/tags are
 * pure localStorage state and never touched the desktop bridge).
 */

import { ulid } from 'ulidx'
import { localStorageKey } from '@/constants/localStorage'
import { chatOrganizationStorageSchema } from '@/schemas/chat-organization.schema'

export interface ChatFolder {
  id: string
  name: string
  updatedAt: number
  logo?: string
}

export interface ChatTag {
  id: string
  /** Unique, case-insensitive */
  name: string
}

export interface ChatOrganizationData {
  folders: ChatFolder[]
  tags: ChatTag[]
}

const MAX_NAME_LENGTH = 200

function validateName(name: string, kind: 'Folder' | 'Tag'): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error(`${kind} name must not be empty`)
  if (trimmed.length > MAX_NAME_LENGTH)
    throw new Error(`${kind} name must be at most ${MAX_NAME_LENGTH} characters`)
  return trimmed
}

const storageKey = localStorageKey.chatOrganization
let storageQueue: Promise<unknown> = Promise.resolve()

function enqueueStorageTask<T>(task: () => T | Promise<T>): Promise<T> {
  const run = storageQueue.then(task, task)
  storageQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function loadFromStorage(): ChatOrganizationData {
  try {
    const stored = localStorage.getItem(storageKey)
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

function saveToStorage(data: ChatOrganizationData): void {
  try {
    const stored = {
      state: { folders: data.folders, tags: data.tags },
      version: 0,
    }
    localStorage.setItem(storageKey, JSON.stringify(stored))
  } catch (error) {
    console.error('Error saving chat organization to localStorage:', error)
    throw error
  }
}

export async function getOrganization(): Promise<ChatOrganizationData> {
  return enqueueStorageTask(() => loadFromStorage())
}

export async function addFolder(name: string): Promise<ChatFolder> {
  const trimmed = validateName(name, 'Folder')

  return enqueueStorageTask(() => {
    const newFolder: ChatFolder = {
      id: ulid(),
      name: trimmed,
      updatedAt: Date.now(),
    }

    const data = loadFromStorage()
    saveToStorage({ ...data, folders: [...data.folders, newFolder] })

    return newFolder
  })
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const trimmed = validateName(name, 'Folder')

  await enqueueStorageTask(() => {
    const data = loadFromStorage()
    const folders = data.folders.map((folder) =>
      folder.id === id
        ? { ...folder, name: trimmed, updatedAt: Date.now() }
        : folder
    )
    saveToStorage({ ...data, folders })
  })
}

export async function deleteFolder(id: string): Promise<void> {
  await enqueueStorageTask(() => {
    const data = loadFromStorage()
    saveToStorage({
      ...data,
      folders: data.folders.filter((folder) => folder.id !== id),
    })
  })
}

export async function addTag(name: string): Promise<ChatTag> {
  const trimmed = validateName(name, 'Tag')

  return enqueueStorageTask(() => {
    const data = loadFromStorage()
    if (
      data.tags.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())
    ) {
      throw new Error(`Tag "${trimmed}" already exists`)
    }

    const newTag: ChatTag = { id: ulid(), name: trimmed }
    saveToStorage({ ...data, tags: [...data.tags, newTag] })

    return newTag
  })
}

export async function renameTag(id: string, name: string): Promise<void> {
  const trimmed = validateName(name, 'Tag')

  await enqueueStorageTask(() => {
    const data = loadFromStorage()
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
    saveToStorage({ ...data, tags })
  })
}

export async function deleteTag(id: string): Promise<void> {
  await enqueueStorageTask(() => {
    const data = loadFromStorage()
    saveToStorage({
      ...data,
      tags: data.tags.filter((tag) => tag.id !== id),
    })
  })
}
