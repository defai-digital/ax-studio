import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'
import { appendUniqueString } from '@/lib/utils/array'

export type ToolApprovalModalProps = {
  toolName: string
  threadId: string
  toolParameters?: object
  onApprove: (allowOnce: boolean) => void
  onDeny: () => void
}

type ToolApprovalState = {
  // Track approved tools per thread
  approvedTools: Record<string, string[]> // threadId -> toolNames[]
  // Global MCP permission toggle
  allowAllMCPPermissions: boolean
  // Modal state
  isModalOpen: boolean
  modalProps: ToolApprovalModalProps | null

  // Actions
  approveToolForThread: (threadId: string, toolName: string) => void
  isToolApproved: (threadId: string, toolName: string) => boolean
  showApprovalModal: (toolName: string, threadId: string, toolParameters?: object) => Promise<boolean>
  closeModal: () => void
  setModalOpen: (open: boolean) => void
  setAllowAllMCPPermissions: (allow: boolean) => void
}

const MAX_APPROVED_TOOL_THREADS = 200
const MAX_APPROVED_TOOLS_PER_THREAD = 200

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

function normalizeToolList(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map(normalizeNonEmptyString)
    .filter((toolName): toolName is string => toolName !== undefined)
    .filter((toolName, index, allTools) => allTools.indexOf(toolName) === index)
    .slice(-MAX_APPROVED_TOOLS_PER_THREAD)
}

function normalizeApprovedTools(
  value: unknown
): Record<string, string[]> {
  if (!isPlainRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(
        ([threadId, tools]) =>
          [normalizeNonEmptyString(threadId), normalizeToolList(tools)] as const
      )
      .filter(
        (entry): entry is [string, string[]] =>
          entry[0] !== undefined && entry[1].length > 0
      )
      .slice(-MAX_APPROVED_TOOL_THREADS)
  )
}

function sanitizePersistedToolApproval(
  persisted: unknown,
  current: ToolApprovalState
): ToolApprovalState {
  if (!isPlainRecord(persisted)) return current

  return {
    ...current,
    approvedTools: normalizeApprovedTools(persisted.approvedTools),
    allowAllMCPPermissions:
      typeof persisted.allowAllMCPPermissions === 'boolean'
        ? persisted.allowAllMCPPermissions
        : current.allowAllMCPPermissions,
    isModalOpen: false,
    modalProps: null,
  }
}

export const useToolApproval = create<ToolApprovalState>()(
  persist(
    (set, get) => ({
      approvedTools: {},
      allowAllMCPPermissions: false,
      isModalOpen: false,
      modalProps: null,

      approveToolForThread: (threadId: string, toolName: string) => {
        const normalizedThreadId = normalizeNonEmptyString(threadId)
        const normalizedToolName = normalizeNonEmptyString(toolName)
        if (!normalizedThreadId || !normalizedToolName) return

        set((state) => ({
          approvedTools: {
            ...state.approvedTools,
            [normalizedThreadId]: appendUniqueString(
              normalizeToolList(state.approvedTools[normalizedThreadId]),
              normalizedToolName
            ).slice(-MAX_APPROVED_TOOLS_PER_THREAD),
          },
        }))
      },

      isToolApproved: (threadId: string, toolName: string) => {
        const normalizedThreadId = normalizeNonEmptyString(threadId)
        const normalizedToolName = normalizeNonEmptyString(toolName)
        if (!normalizedThreadId || !normalizedToolName) return false

        const state = get()
        return (
          normalizeToolList(state.approvedTools[normalizedThreadId]).includes(
            normalizedToolName
          ) || false
        )
      },

      showApprovalModal: (toolName: string, threadId: string, toolParameters?: object) => {
        return new Promise<boolean>((resolve) => {
          const normalizedThreadId = normalizeNonEmptyString(threadId)
          const normalizedToolName = normalizeNonEmptyString(toolName)
          if (!normalizedThreadId || !normalizedToolName) {
            resolve(false)
            return
          }

          const state = get()

          // Resolve any orphaned previous modal to prevent Promise leak
          if (state.modalProps) {
            state.modalProps.onDeny()
          }

          if (state.allowAllMCPPermissions) {
            resolve(true)
            return
          }

          if (state.isToolApproved(threadId, toolName)) {
            resolve(true)
            return
          }

          set({
            isModalOpen: true,
            modalProps: {
              toolName: normalizedToolName,
              threadId: normalizedThreadId,
              toolParameters,
              onApprove: (allowOnce: boolean) => {
                if (!allowOnce) {
                  // If not "allow once", add to approved tools for this thread
                  get().approveToolForThread(
                    normalizedThreadId,
                    normalizedToolName
                  )
                }
                get().closeModal()
                resolve(true)
              },
              onDeny: () => {
                get().closeModal()
                resolve(false)
              },
            },
          })
        })
      },

      closeModal: () => {
        set({
          isModalOpen: false,
          modalProps: null,
        })
      },

      setModalOpen: (open: boolean) => {
        if (typeof open !== 'boolean') return

        set({ isModalOpen: open })
        if (!open) {
          get().closeModal()
        }
      },

      setAllowAllMCPPermissions: (allow: boolean) => {
        if (typeof allow !== 'boolean') return

        set({ allowAllMCPPermissions: allow })
      },
    }),
    {
      name: localStorageKey.toolApproval,
      storage: createSafeJSONStorage(() => localStorage, 'useToolApproval'),
      merge: (persisted, current) =>
        sanitizePersistedToolApproval(persisted, current),
      // Only persist approved tools and global permission setting, not modal state
      partialize: (state) => ({
        approvedTools: normalizeApprovedTools(state.approvedTools),
        allowAllMCPPermissions: state.allowAllMCPPermissions,
      }),
    }
  )
)
