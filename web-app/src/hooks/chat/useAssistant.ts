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
  // Single built-in default assistant (matrix §3) — the assistant extension
  // and its persistence are gone, so mutations are in-memory only.
  addAssistant: (assistant) => {
    set((state) => ({ assistants: [...state.assistants, assistant] }))
  },
  updateAssistant: (assistant) => {
    set((state) => ({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      currentAssistant:
        state.currentAssistant?.id === assistant.id
          ? assistant
          : state.currentAssistant,
    }))
  },
  deleteAssistant: (id) => {
    const state = get()
    const wasCurrentAssistant = state.currentAssistant?.id === id

    set({
      assistants: state.assistants.filter((assistant) => assistant.id !== id),
      currentAssistant: wasCurrentAssistant
        ? defaultAssistant
        : state.currentAssistant,
    })

    // If the deleted assistant was current, fallback to default and update localStorage
    if (wasCurrentAssistant) {
      setLastUsedAssistantId(defaultAssistant.id)
    }
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
