/**
 * Chat Organization Service Types
 * Types for chat folder and tag management operations
 *
 * NOTE: named `ChatFolder` (not `ThreadFolder`) to avoid clashing with the
 * projects service type of the same name.
 */

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

export interface ChatOrganizationService {
  /**
   * Get the full organization document (folders + tags)
   */
  getOrganization(): Promise<ChatOrganizationData>

  /**
   * Add a new chat folder
   */
  addFolder(name: string): Promise<ChatFolder>

  /**
   * Rename an existing chat folder
   */
  renameFolder(id: string, name: string): Promise<void>

  /**
   * Delete a chat folder (does not touch thread membership — the store
   * clears `thread.metadata.folderId` on member threads before calling this)
   */
  deleteFolder(id: string): Promise<void>

  /**
   * Add a new tag. Names are unique case-insensitive; throws on duplicate.
   */
  addTag(name: string): Promise<ChatTag>

  /**
   * Rename an existing tag. Names are unique case-insensitive; throws on duplicate.
   */
  renameTag(id: string, name: string): Promise<void>

  /**
   * Delete a tag (does not touch thread membership — the store clears the
   * tag id from `thread.metadata.tagIds` on member threads before calling this)
   */
  deleteTag(id: string): Promise<void>
}
