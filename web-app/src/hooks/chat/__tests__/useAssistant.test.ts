import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAssistant, defaultAssistant } from '../useAssistant'

const mockCreateAssistant = vi.fn()
const mockDeleteAssistant = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    assistants: () => ({
      createAssistant: mockCreateAssistant,
      deleteAssistant: mockDeleteAssistant,
    }),
  }),
}))

describe('useAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAssistant.mockResolvedValue(undefined)
    mockDeleteAssistant.mockResolvedValue(undefined)
    localStorage.clear()
    // Reset Zustand store to default state
    act(() => {
      useAssistant.setState({
        assistants: [defaultAssistant],
        currentAssistant: defaultAssistant,
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.assistants).toEqual([defaultAssistant])
    expect(result.current.currentAssistant).toEqual(defaultAssistant)
  })

  it('should add assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Assistant',
      avatar: '🤖',
      description: 'A new assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.addAssistant(newAssistant)
    })

    expect(result.current.assistants).toHaveLength(2)
    expect(result.current.assistants).toContain(newAssistant)
  })

  it('should update assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const updatedAssistant = {
      ...defaultAssistant,
      name: 'Updated Ax-Studio',
      description: 'Updated description',
    }

    act(() => {
      result.current.updateAssistant(updatedAssistant)
    })

    expect(result.current.assistants[0].name).toBe('Updated Ax-Studio')
    expect(result.current.assistants[0].description).toBe('Updated description')
  })

  it('should delete assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const assistant2 = {
      id: 'assistant-2',
      name: 'Assistant 2',
      avatar: '🤖',
      description: 'Second assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.addAssistant(assistant2)
    })

    expect(result.current.assistants).toHaveLength(2)

    act(() => {
      result.current.deleteAssistant('assistant-2')
    })

    expect(result.current.assistants).toHaveLength(1)
    expect(result.current.assistants[0].id).toBe('ax-studio')
  })

  it('rolls back assistant deletion when persistence fails', async () => {
    const { result } = renderHook(() => useAssistant())
    const assistant2 = {
      id: 'assistant-2',
      name: 'Assistant 2',
      avatar: '🤖',
      description: 'Second assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.addAssistant(assistant2)
      result.current.setCurrentAssistant(assistant2)
    })

    mockDeleteAssistant.mockRejectedValueOnce(new Error('disk full'))

    act(() => {
      result.current.deleteAssistant('assistant-2')
    })

    await vi.waitFor(() => {
      expect(result.current.assistants).toContainEqual(assistant2)
      expect(result.current.currentAssistant).toEqual(assistant2)
    })
  })

  it('should set current assistant', () => {
    const { result } = renderHook(() => useAssistant())

    const newAssistant = {
      id: 'assistant-2',
      name: 'New Current Assistant',
      avatar: '🤖',
      description: 'New current assistant',
      instructions: 'Help the user',
      created_at: Date.now(),
      parameters: {},
    }

    act(() => {
      result.current.setCurrentAssistant(newAssistant)
    })

    expect(result.current.currentAssistant).toEqual(newAssistant)
  })

  it('should set assistants', () => {
    const { result } = renderHook(() => useAssistant())

    const assistants = [
      {
        id: 'assistant-1',
        name: 'Assistant 1',
        avatar: '🤖',
        description: 'First assistant',
        instructions: 'Help the user',
        created_at: Date.now(),
        parameters: {},
      },
      {
        id: 'assistant-2',
        name: 'Assistant 2',
        avatar: '🔧',
        description: 'Second assistant',
        instructions: 'Help with tasks',
        created_at: Date.now(),
        parameters: {},
      },
    ]

    act(() => {
      result.current.setAssistants(assistants)
    })

    expect(result.current.assistants).toEqual(assistants)
    expect(result.current.assistants).toHaveLength(2)
  })

  it('should maintain assistant structure', () => {
    const { result } = renderHook(() => useAssistant())

    expect(result.current.currentAssistant.id).toBe('ax-studio')
    expect(result.current.currentAssistant.name).toBe('Ax-Studio')
    expect(result.current.currentAssistant.avatar).toBe('🧵')
    expect(result.current.currentAssistant.instructions).toContain(
      'Before engaging any tools, articulate your complete thought process in natural language'
    )
    expect(typeof result.current.currentAssistant.created_at).toBe('number')
    expect(typeof result.current.currentAssistant.parameters).toBe('object')
  })

  it('should handle empty assistants list', () => {
    const { result } = renderHook(() => useAssistant())

    act(() => {
      result.current.setAssistants([])
    })

    expect(result.current.assistants).toEqual([])
  })

  it('should update assistant in current assistant if it matches', () => {
    const { result } = renderHook(() => useAssistant())

    const updatedDefaultAssistant = {
      ...defaultAssistant,
      name: 'Updated Ax-Studio Name',
    }

    act(() => {
      result.current.updateAssistant(updatedDefaultAssistant)
    })

    expect(result.current.currentAssistant.name).toBe('Updated Ax-Studio Name')
  })
})
