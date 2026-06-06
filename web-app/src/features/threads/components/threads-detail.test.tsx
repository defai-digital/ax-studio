import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route } from '@/routes/threads/$threadId'

// Mock dependencies
vi.mock('@/features/threads/hooks/useThreads', () => ({
  useThreads: vi.fn(),
}))

vi.mock('@/features/assistants/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [],
    currentAssistant: null,
    setCurrentAssistant: vi.fn(),
  }),
}))

vi.mock('@/hooks/useTools', () => ({
  useTools: vi.fn(),
}))

vi.mock('@/hooks/use-chat', () => ({
  useChat: () => ({
    messages: [],
    status: 'ready',
    error: null,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    setMessages: vi.fn(),
    stop: vi.fn(),
    addToolOutput: vi.fn(),
  }),
}))

vi.mock('@/features/models/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: null,
    selectedProvider: null,
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    globalDefaultPrompt: '',
    autoTuningEnabled: false,
  }),
}))

vi.mock('@/features/chat/hooks/useMessages', () => ({
  useMessages: () => ({
    messages: {},
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-memory', () => ({
  useThreadMemory: () => ({
    memorySuffix: '',
    lastUserInputRef: { current: '' },
    processMemoryOnFinish: vi.fn(),
    handleRememberCommand: vi.fn(),
    handleForgetCommand: vi.fn(),
  }),
}))

vi.mock('@/hooks/useLocalKnowledge', () => ({
  useLocalKnowledge: () => ({
    isLocalKnowledgeEnabledForThread: vi.fn().mockReturnValue(false),
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-artifacts', () => ({
  useThreadArtifacts: () => ({
    pinnedArtifact: null,
    clearArtifact: vi.fn(),
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-research', () => ({
  useThreadResearch: () => ({
    pinnedResearch: null,
    clearResearch: vi.fn(),
    handleResearchCommand: vi.fn(),
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-config', () => ({
  useThreadConfig: () => ({
    promptResolution: { resolvedPrompt: '' },
    optimizedModelConfig: {
      modelId: '',
      temperature: 0,
      top_p: 0,
      max_output_tokens: 0,
    },
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-tools', () => ({
  useThreadTools: () => ({
    followUpMessage: null,
    onToolCall: vi.fn(),
    startToolExecution: vi.fn(),
    onCostApproval: vi.fn(),
    costApprovalState: null,
    setCostApprovalState: vi.fn(),
    agentTeams: [],
    activeTeamId: null,
    activeTeam: null,
    activeTeamSnapshot: null,
    showVariablePrompt: false,
    setShowVariablePrompt: vi.fn(),
    teamTokensUsed: 0,
    setTeamTokensUsed: vi.fn(),
    handleVariableSubmit: vi.fn(),
    handleTeamChange: vi.fn(),
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-split', () => ({
  useThreadSplit: () => ({
    splitPaneOrder: [],
    splitThreadId: null,
    setSplitThreadId: vi.fn(),
    setSplitDirection: vi.fn(),
    handleSplit: vi.fn(),
  }),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-effects', () => ({
  useThreadEffects: vi.fn(),
}))

vi.mock('@/features/threads/hooks/thread/use-thread-chat', () => ({
  useThreadChat: () => ({
    processAndSendMessage: vi.fn(),
    persistMessageOnFinish: vi.fn(),
    handleRegenerate: vi.fn(),
    handleEditMessage: vi.fn(),
    handleDeleteMessage: vi.fn(),
    handleContextSizeIncrease: vi.fn(),
  }),
}))

vi.mock('@/features/threads/components/ThreadView', () => ({
  ThreadView: () => <div data-testid="thread-view" />,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi
    .fn()
    .mockImplementation((path: string) =>
      vi.fn().mockImplementation((config: any) => ({ ...config, id: path }))
    ),
  useParams: vi.fn(),
  useNavigate: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: vi.fn().mockImplementation((selector) => selector),
}))

import { useParams, useNavigate } from '@tanstack/react-router'
import { useThreads } from '@/features/threads/hooks/useThreads'

describe('Threads Detail Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should navigate to home for invalid threadId format', () => {
    const mockNavigate = vi.fn()
    ;(useNavigate as any).mockReturnValue(mockNavigate)
    ;(useParams as any).mockReturnValue({ threadId: 'invalid-id' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('should render ThreadView for valid threadId and existing thread', () => {
    const mockNavigate = vi.fn()
    ;(useNavigate as any).mockReturnValue(mockNavigate)
    ;(useParams as any).mockReturnValue({
      threadId: '12345678-1234-1234-1234-123456789abc',
    })
    ;(useThreads as any).mockReturnValue({ title: 'Test Thread' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('thread-view')).toBeInTheDocument()
  })

  it('should navigate to home if thread does not exist', () => {
    const mockNavigate = vi.fn()
    ;(useNavigate as any).mockReturnValue(mockNavigate)
    ;(useParams as any).mockReturnValue({
      threadId: '12345678-1234-1234-1234-123456789abc',
    })
    ;(useThreads as any).mockReturnValue(undefined)

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
  })
})
