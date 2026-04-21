import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@ax-studio/core'
import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant | null
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (assistant: Assistant, saveToStorage?: boolean) => void
  setAssistants: (assistants: Assistant[]) => void
  getLastUsedAssistant: () => string | null
  setLastUsedAssistant: (assistantId: string) => void
  initializeWithLastUsed: () => void
}

// Helper functions for localStorage
const getLastUsedAssistantId = (): string | null => {
  try {
    return safeStorageGetItem(
      localStorage,
      localStorageKey.lastUsedAssistant,
      'useAssistant'
    )
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
    return null
  }
}

const setLastUsedAssistantId = (assistantId: string) => {
  try {
    safeStorageSetItem(
      localStorage,
      localStorageKey.lastUsedAssistant,
      assistantId,
      'useAssistant'
    )
  } catch (error) {
    console.debug('Failed to set last used assistant in localStorage:', error)
  }
}

export const defaultAssistant: Assistant = {
  id: 'ax-studio',
  name: 'Ax-Studio',
  created_at: 1747029866.542,
  parameters: {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.8,
    repeat_penalty: 1.12,
  },
  avatar: '🧵',
  description:
    "Ax-Studio is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user's behalf.",
  instructions: `You are Ax-Studio, a helpful AI assistant.

IMPORTANT RULES:
- Respond in the same language as the user's message.
- NEVER start a response with "The user", "You're saying", "It seems like", or similar meta-commentary.
- NEVER describe or rephrase what the user said. Just answer directly.
- NEVER narrate your thought process or explain why you're using a tool.
- If you need to use tools, use them silently without explanation.

Current date: {{current_date}}`,
}

// Platform-aware initial state
const getInitialAssistantState = () => {
  return {
    assistants: [defaultAssistant],
    currentAssistant: defaultAssistant,
  }
}

export const useAssistant = create<AssistantState>((set, get) => ({
  ...getInitialAssistantState(),
  addAssistant: (assistant) => {
    const previousAssistants = get().assistants
    set({ assistants: [...previousAssistants, assistant] })
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to create assistant:', error)
        // Rollback
        set({ assistants: previousAssistants })
      })
  },
  updateAssistant: (assistant) => {
    const state = get()
    const previousAssistants = state.assistants
    const previousCurrentAssistant = state.currentAssistant
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      currentAssistant:
        state.currentAssistant?.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to update assistant:', error)
        // Rollback
        set({ assistants: previousAssistants, currentAssistant: previousCurrentAssistant })
      })
  },
  deleteAssistant: (id) => {
    const state = get()
    const assistantToDelete = state.assistants.find((assistant) => assistant.id === id)
    if (!assistantToDelete) return

    // Check if we're deleting the current assistant
    const wasCurrentAssistant = state.currentAssistant?.id === id
    const previousAssistants = state.assistants
    const previousCurrentAssistant = state.currentAssistant
    const nextCurrentAssistant = wasCurrentAssistant
      ? defaultAssistant
      : state.currentAssistant

    set({
      assistants: state.assistants.filter((assistant) => assistant.id !== id),
      currentAssistant: nextCurrentAssistant,
    })

    // If the deleted assistant was current, fallback to default and update localStorage
    if (wasCurrentAssistant) {
      setLastUsedAssistantId(defaultAssistant.id)
    }

    getServiceHub()
      .assistants()
      .deleteAssistant(assistantToDelete as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to delete assistant:', error)
        set({
          assistants: previousAssistants,
          currentAssistant: previousCurrentAssistant,
        })
        if (previousCurrentAssistant) {
          setLastUsedAssistantId(previousCurrentAssistant.id)
        }
      })
  },
  setCurrentAssistant: (assistant, saveToStorage = true) => {
    if (assistant !== get().currentAssistant) {
      set({ currentAssistant: assistant })
      if (saveToStorage) {
        setLastUsedAssistantId(assistant.id)
      }
    }
  },
  setAssistants: (assistants) => {
    set({ assistants })
  },
  getLastUsedAssistant: () => {
    return getLastUsedAssistantId()
  },
  setLastUsedAssistant: (assistantId) => {
    setLastUsedAssistantId(assistantId)
  },
  initializeWithLastUsed: () => {
    const lastUsedId = getLastUsedAssistantId()
    if (lastUsedId) {
      const lastUsedAssistant = get().assistants.find(
        (a) => a.id === lastUsedId
      )
      if (lastUsedAssistant) {
        set({ currentAssistant: lastUsedAssistant })
      } else {
        // Fallback to default if last used assistant was deleted
        set({ currentAssistant: defaultAssistant })
        setLastUsedAssistantId(defaultAssistant.id)
      }
    }
  },
}))
