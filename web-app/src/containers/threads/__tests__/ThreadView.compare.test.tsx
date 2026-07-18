/**
 * ThreadView compare-mode wiring tests.
 *
 * The heavy child panes are mocked; the test asserts the compare session
 * binds two distinct models to the two panes and that the shared composer
 * dispatches the same prompt to BOTH threads' send handlers.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { ThreadView, type ThreadViewProps } from '../ThreadView'

const { mockSplitSend, mainPaneProps, splitPaneProps, splitRegistration } = vi.hoisted(() => ({
  mockSplitSend: vi.fn(),
  mainPaneProps: [] as Record<string, unknown>[],
  splitPaneProps: [] as Record<string, unknown>[],
  splitRegistration: { enabled: true },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/containers/threads/MainThreadPane', () => ({
  MainThreadPane: (props: Record<string, unknown>) => {
    mainPaneProps.push(props)
    return <div data-testid="main-pane" />
  },
}))

vi.mock('@/containers/threads/SplitThreadContainer', async () => {
  const React = await import('react')
  return {
    SplitThreadContainer: (props: {
      registerSend?: (fn: ((text: string) => Promise<void>) | null) => void
    }) => {
      splitPaneProps.push(props)
      // Mirror the real container: register the pane's send handler while
      // compare mode is active, unregister on cleanup.
      React.useEffect(() => {
        if (!props.registerSend || !splitRegistration.enabled) return
        props.registerSend(mockSplitSend)
        return () => props.registerSend?.(null)
      }, [props.registerSend])
      return <div data-testid="split-pane" />
    },
  }
})

vi.mock('@/containers/threads/CompareModelsDialog', () => ({
  CompareModelsDialog: (props: {
    open: boolean
    onConfirm: (a: ThreadModel, b: ThreadModel) => void
  }) =>
    props.open ? (
      <button
        data-testid="mock-compare-confirm"
        onClick={() =>
          props.onConfirm(
            { id: 'model-a', provider: 'provider-a' },
            { id: 'model-b', provider: 'provider-b' }
          )
        }
      >
        confirm
      </button>
    ) : null,
}))

const modelA: ThreadModel = { id: 'model-a', provider: 'provider-a' }
const modelB: ThreadModel = { id: 'model-b', provider: 'provider-b' }

const makeThread = (): Thread =>
  ({
    id: 'thread-1',
    title: 'Main Thread',
    updated: 0,
    model: modelA,
  }) as unknown as Thread

const makeProps = (
  overrides: Partial<ThreadViewProps> = {}
): ThreadViewProps => ({
  threadId: 'thread-1',
  thread: makeThread(),
  threadModel: modelA,
  threadLogo: '',
  chatMessages: [],
  status: 'ready',
  error: undefined,
  stop: vi.fn(),
  handleSubmit: vi.fn().mockResolvedValue(undefined),
  handleRegenerate: vi.fn(),
  handleEditMessage: vi.fn(),
  handleDeleteMessage: vi.fn(),
  handleSwitchVersion: vi.fn(),
  handleContextSizeIncrease: vi.fn().mockResolvedValue(undefined),
  reasoningContainerRef: { current: null },
  splitPaneOrder: null,
  splitThreadId: null,
  handleSplit: vi.fn().mockResolvedValue(undefined),
  compareModels: null,
  handleCompare: vi.fn().mockResolvedValue(undefined),
  closeSplit: vi.fn(),
  showThreadPromptEditor: false,
  setShowThreadPromptEditor: vi.fn(),
  threadPromptDraft: '',
  setThreadPromptDraft: vi.fn(),
  promptResolution: { source: 'global', resolvedPrompt: '' },
  updateThread: vi.fn(),
  ...overrides,
})

describe('ThreadView — compare mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mainPaneProps.length = 0
    splitPaneProps.length = 0
    splitRegistration.enabled = true
    mockSplitSend.mockResolvedValue(undefined)
  })

  it('starts compare mode from the Split View menu with two distinct models', async () => {
    const user = userEvent.setup()
    const props = makeProps()
    render(<ThreadView {...props} />)

    await user.click(screen.getByRole('button', { name: 'Split View' }))
    const item = await screen.findByText('Compare models')
    await user.click(item)

    await user.click(await screen.findByTestId('mock-compare-confirm'))

    expect(props.handleCompare).toHaveBeenCalledTimes(1)
    const [a, b] = (props.handleCompare as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(a).toEqual(modelA)
    expect(b).toEqual(modelB)
    // The session must bind two distinct models.
    expect(a.id).not.toBe(b.id)
  })

  it('hides per-pane composers, shows model badges, and dispatches the shared composer to both threads', async () => {
    const user = userEvent.setup()
    const props = makeProps({
      splitPaneOrder: ['main', 'split'],
      splitThreadId: 'thread-2',
      compareModels: [modelA, modelB],
    })
    render(<ThreadView {...props} />)

    // Shared composer visible with both model labels.
    expect(screen.getByTestId('compare-composer')).toBeInTheDocument()
    expect(screen.getByText('model-a')).toBeInTheDocument()
    expect(screen.getByText('model-b')).toBeInTheDocument()

    // Both panes render with their composer hidden and a model badge.
    expect(mainPaneProps[0]?.hideComposer).toBe(true)
    expect(mainPaneProps[0]?.headerBadge).toBe('model-a')
    expect(splitPaneProps[0]?.hideComposer).toBe(true)
    expect(splitPaneProps[0]?.headerBadge).toBe('model-b')

    // The split pane registered its own send handler.
    await waitFor(() => expect(mockSplitSend).not.toHaveBeenCalled())
    expect(splitPaneProps[0]?.registerSend).toBeTypeOf('function')

    // Send from the shared composer → same prompt to both thread send paths.
    const textarea = screen.getByLabelText('Compare models composer')
    await user.type(textarea, 'compare this')
    await user.click(screen.getByRole('button', { name: 'Send to both models' }))

    await waitFor(() => {
      expect(props.handleSubmit).toHaveBeenCalledWith('compare this')
      expect(mockSplitSend).toHaveBeenCalledWith('compare this')
    })
  })

  it('keeps send disabled until the split pane has registered', () => {
    splitRegistration.enabled = false
    const props = makeProps({
      splitPaneOrder: ['main', 'split'],
      splitThreadId: 'thread-2',
      compareModels: [modelA, modelB],
    })
    render(<ThreadView {...props} />)

    const textarea = screen.getByLabelText('Compare models composer')
    expect(textarea).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Send to both models' })
    ).toBeDisabled()
    expect(props.handleSubmit).not.toHaveBeenCalled()
    expect(mockSplitSend).not.toHaveBeenCalled()
  })

  it('disables the shared composer while a pane is generating', () => {
    const props = makeProps({
      status: 'streaming',
      splitPaneOrder: ['main', 'split'],
      splitThreadId: 'thread-2',
      compareModels: [modelA, modelB],
    })
    render(<ThreadView {...props} />)

    expect(screen.getByLabelText('Compare models composer')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Send to both models' })
    ).toBeDisabled()
  })

  it('regular split view keeps per-pane composers and no shared composer', () => {
    const props = makeProps({
      splitPaneOrder: ['main', 'split'],
      splitThreadId: 'thread-2',
      compareModels: null,
    })
    render(<ThreadView {...props} />)

    expect(screen.queryByTestId('compare-composer')).not.toBeInTheDocument()
    expect(mainPaneProps[0]?.hideComposer).toBe(false)
    expect(mainPaneProps[0]?.headerBadge).toBeUndefined()
    expect(splitPaneProps[0]?.hideComposer).toBe(false)
    expect(splitPaneProps[0]?.registerSend).toBeUndefined()
  })

  it('Close Split View delegates to closeSplit (clears split + compare)', async () => {
    const user = userEvent.setup()
    const props = makeProps({
      splitPaneOrder: ['main', 'split'],
      splitThreadId: 'thread-2',
      compareModels: [modelA, modelB],
    })
    render(<ThreadView {...props} />)

    await user.click(screen.getByRole('button', { name: 'Split View' }))
    const item = await screen.findByText('Close Split View')
    await user.click(item)

    expect(props.closeSplit).toHaveBeenCalledTimes(1)
  })
})
