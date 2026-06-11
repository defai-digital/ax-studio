import { ContentType, MessageStatus, type ThreadMessage } from '@ax-studio/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isTauri: false,
  serviceHub: null as any,
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => mocks.isTauri,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => mocks.serviceHub,
}))

vi.mock('sonner', () => ({
  toast: mocks.toast,
}))

import { exportAllThreads, exportThread } from '../thread-export'

const thread = {
  id: 'thread-1',
  title: 'Project: Launch Plan!',
  updated: 1_736_200_000_000,
}

const message: ThreadMessage = {
  id: 'msg-1',
  object: 'thread.message',
  thread_id: 'thread-1',
  role: 'user',
  content: [
    {
      type: ContentType.Text,
      text: { value: 'Draft the launch email.', annotations: [] },
    },
  ],
  status: MessageStatus.Ready,
  created_at: 1_736_200_000_000,
  completed_at: 1_736_200_000_100,
}

describe('thread export', () => {
  const fetchMessages = vi.fn()
  const fetchThreads = vi.fn()
  const save = vi.fn()
  const invoke = vi.fn()
  const createObjectURL = vi.fn(() => 'blob:export')
  const revokeObjectURL = vi.fn()
  const click = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-02T12:00:00.000Z'))
    mocks.isTauri = false
    mocks.serviceHub = {
      messages: () => ({ fetchMessages }),
      threads: () => ({ fetchThreads }),
      dialog: () => ({ save }),
      core: () => ({ invoke }),
    }
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click)
  })

  it('shows an unavailable toast when service hub is missing', async () => {
    mocks.serviceHub = null

    await exportThread(thread, 'json')

    expect(mocks.toast.error).toHaveBeenCalledWith('Export unavailable')
  })

  it('warns when a thread has no messages to export', async () => {
    fetchMessages.mockResolvedValueOnce([])

    await exportThread(thread, 'csv')

    expect(fetchMessages).toHaveBeenCalledWith('thread-1')
    expect(mocks.toast.warning).toHaveBeenCalledWith('No messages to export')
  })

  it('downloads a single thread export in web mode', async () => {
    fetchMessages.mockResolvedValueOnce([message])

    await exportThread(thread, 'json')

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'Exported "Project: Launch Plan!" as JSON',
    )
  })

  it('writes a single thread export through Tauri when a save path is selected', async () => {
    mocks.isTauri = true
    fetchMessages.mockResolvedValueOnce([message])
    save.mockResolvedValueOnce('/tmp/project-launch-plan-2025-01-02-csv.csv')

    await exportThread(thread, 'csv')

    expect(save).toHaveBeenCalledWith({
      defaultPath: 'project-launch-plan-2025-01-02-csv.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    expect(invoke).toHaveBeenCalledWith('write_text_file', {
      path: '/tmp/project-launch-plan-2025-01-02-csv.csv',
      content: expect.stringContaining('workspace_id,workspace_name,thread_id'),
    })
  })

  it('does not write when the Tauri save dialog is cancelled', async () => {
    mocks.isTauri = true
    fetchMessages.mockResolvedValueOnce([message])
    save.mockResolvedValueOnce(null)

    await exportThread(thread, 'openai-jsonl')

    expect(invoke).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('exports all threads and fetches messages for each valid thread', async () => {
    fetchThreads.mockResolvedValueOnce([
      thread,
      { id: 'thread-2', title: '', updated: 0 },
    ])
    fetchMessages
      .mockResolvedValueOnce([message])
      .mockResolvedValueOnce([{ ...message, id: 'msg-2', thread_id: 'thread-2' }])

    await exportAllThreads('alpaca')

    expect(fetchMessages).toHaveBeenCalledWith('thread-1')
    expect(fetchMessages).toHaveBeenCalledWith('thread-2')
    expect(click).toHaveBeenCalledTimes(1)
    expect(mocks.toast.success).toHaveBeenCalledWith(
      'Exported 2 chats as JSON (Alpaca)',
    )
  })

  it('warns when there are no chats to export', async () => {
    fetchThreads.mockResolvedValueOnce([])

    await exportAllThreads('json')

    expect(mocks.toast.warning).toHaveBeenCalledWith('No chats to export')
  })

  it('shows an error toast when export fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMessages.mockRejectedValueOnce(new Error('disk unavailable'))

    await exportThread(thread, 'json')

    expect(error).toHaveBeenCalledWith(
      'Failed to export thread:',
      expect.any(Error),
    )
    expect(mocks.toast.error).toHaveBeenCalledWith('Failed to export chat')
  })
})
