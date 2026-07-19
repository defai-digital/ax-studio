import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@ax-studio/core'
import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage/storage'

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
  name: 'AX Studio',
  created_at: 1747029866.542,
  parameters: {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.8,
    repeat_penalty: 1.12,
  },
  avatar: '🧵',
  description:
    "AX Studio is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user's behalf.",
  instructions: `You are AX Studio, a helpful AI assistant who assists users with their requests.

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

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
    set((state) => ({ assistants: [...state.assistants, assistant] }))
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to create assistant:', error)
        // Remove only this optimistic entry. Replaying a whole snapshot would
        // erase assistants added while the request was in flight.
        set((state) => ({
          assistants: state.assistants.filter(
            (candidate) => candidate !== assistant
          ),
        }))
      })
  },
  updateAssistant: (assistant) => {
    const state = get()
    const previousAssistant = state.assistants.find(
      (candidate) => candidate.id === assistant.id
    )
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
        set((current) => ({
          assistants: previousAssistant
            ? current.assistants.map((candidate) =>
                candidate === assistant ? previousAssistant : candidate
              )
            : current.assistants.filter((candidate) => candidate !== assistant),
          currentAssistant:
            current.currentAssistant === assistant
              ? previousCurrentAssistant
              : current.currentAssistant,
        }))
      })
  },
  deleteAssistant: (id) => {
    const state = get()
    const assistantToDelete = state.assistants.find(
      (assistant) => assistant.id === id
    )
    if (!assistantToDelete) return

    // Check if we're deleting the current assistant
    const wasCurrentAssistant = state.currentAssistant?.id === id
    const previousCurrentAssistant = state.currentAssistant
    const deletedIndex = state.assistants.indexOf(assistantToDelete)
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
        let restoredCurrent = false
        set((current) => {
          if (current.assistants.some((assistant) => assistant.id === id)) {
            return current
          }
          const assistants = [...current.assistants]
          assistants.splice(
            Math.min(deletedIndex, assistants.length),
            0,
            assistantToDelete
          )
          const shouldRestoreCurrent =
            wasCurrentAssistant && current.currentAssistant === defaultAssistant
          restoredCurrent = shouldRestoreCurrent
          return {
            assistants,
            currentAssistant: shouldRestoreCurrent
              ? previousCurrentAssistant
              : current.currentAssistant,
          }
        })
        if (restoredCurrent && previousCurrentAssistant) {
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
