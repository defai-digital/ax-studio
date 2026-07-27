import { create } from 'zustand'
import {
  clearStoredHuggingFaceToken,
  normalizeHuggingFaceToken,
  readStoredHuggingFaceToken,
  storeHuggingFaceToken,
  validateHuggingFaceToken,
} from '@/lib/huggingface/token-storage'

type HuggingFaceConnectionState = {
  token?: string
  accountName?: string
  initialized: boolean
  isLoading: boolean
  isConnecting: boolean
  dialogOpen: boolean
  error?: string
  initialize: () => Promise<void>
  connect: (token: string, signal?: AbortSignal) => Promise<void>
  disconnect: () => Promise<void>
  setDialogOpen: (open: boolean) => void
}

let initializationPromise: Promise<void> | null = null

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Hugging Face did not respond in time. Please try again.'
  }
  return error instanceof Error
    ? error.message
    : 'Unable to update the Hugging Face connection.'
}

export const useHuggingFaceConnection = create<HuggingFaceConnectionState>()(
  (set, get) => ({
    token: undefined,
    accountName: undefined,
    initialized: false,
    isLoading: false,
    isConnecting: false,
    dialogOpen: false,
    error: undefined,

    initialize: async () => {
      if (get().initialized) return
      if (initializationPromise) return initializationPromise

      set({ isLoading: true, error: undefined })
      initializationPromise = (async () => {
        try {
          const token = await readStoredHuggingFaceToken()
          set({
            token: token ?? undefined,
            initialized: true,
            error: undefined,
          })
        } catch (error) {
          set({
            token: undefined,
            initialized: true,
            error: errorMessage(error),
          })
        } finally {
          set({ isLoading: false })
          initializationPromise = null
        }
      })()

      return initializationPromise
    },

    connect: async (value, signal) => {
      const token = normalizeHuggingFaceToken(value)
      set({ isConnecting: true, error: undefined })
      try {
        const account = await validateHuggingFaceToken(token, signal)
        await storeHuggingFaceToken(token)
        set({
          token,
          accountName: account.name ?? account.fullname,
          initialized: true,
          error: undefined,
        })
      } catch (error) {
        set({ error: errorMessage(error) })
        throw error
      } finally {
        set({ isConnecting: false })
      }
    },

    disconnect: async () => {
      set({ isConnecting: true, error: undefined })
      try {
        await clearStoredHuggingFaceToken()
        set({
          token: undefined,
          accountName: undefined,
          initialized: true,
          error: undefined,
        })
      } catch (error) {
        set({ error: errorMessage(error) })
        throw error
      } finally {
        set({ isConnecting: false })
      }
    },

    setDialogOpen: (dialogOpen) => set({ dialogOpen, error: undefined }),
  })
)
