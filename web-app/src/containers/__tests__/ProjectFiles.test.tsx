import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment } from '@/types/attachment'

const {
  mockDialogOpen,
  mockFileStat,
  mockIngestProjectFile,
  mockToastError,
} = vi.hoisted(() => ({
  mockDialogOpen: vi.fn(),
  mockFileStat: vi.fn(),
  mockIngestProjectFile: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: vi.fn(() => undefined) }),
}))

vi.mock('@/hooks/chat/useAttachments', () => ({
  useAttachments: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ enabled: true, maxFileSizeMB: 50 }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: mockDialogOpen }),
    uploads: () => ({
      ingestFileAttachmentForProject: mockIngestProjectFile,
    }),
  }),
}))

vi.mock('@ax-studio/core', () => ({
  fs: {
    fileStat: mockFileStat,
    readdirSync: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: mockToastError,
  },
}))

import { ProjectFiles } from '../ProjectFiles'
import { projectCollectionId, useFileRegistry } from '@/lib/file-registry'

describe('ProjectFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFileRegistry.setState({ files: {} })
    mockFileStat.mockResolvedValue({ isDirectory: false, size: 10 })
  })

  it('opens only one picker when upload is clicked repeatedly', async () => {
    let resolvePicker!: (value: null) => void
    mockDialogOpen.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve
      })
    )
    render(<ProjectFiles projectId="project-1" lng="en" />)
    const upload = await screen.findByRole('button', { name: 'Upload' })

    fireEvent.click(upload)
    fireEvent.click(upload)

    expect(mockDialogOpen).toHaveBeenCalledTimes(1)
    resolvePicker(null)
    await waitFor(() => expect(upload).toBeEnabled())
  })

  it('reloads files that succeeded before a later upload failed', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mockDialogOpen.mockResolvedValue(['/docs/first.pdf', '/docs/second.pdf'])
    mockIngestProjectFile
      .mockImplementationOnce(async (_projectId: string, attachment: Attachment) => {
        const collectionId = projectCollectionId('project-1')
        useFileRegistry.getState().addFile(collectionId, {
          file_id: 'first-id',
          file_name: attachment.name,
          file_path: attachment.path,
          file_type: attachment.fileType,
          file_size: attachment.size,
          chunk_count: 2,
          collection_id: collectionId,
          created_at: '2026-01-01T00:00:00Z',
        })
        return { id: 'first-id' }
      })
      .mockRejectedValueOnce(new Error('second upload failed'))
    render(<ProjectFiles projectId="project-1" lng="en" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Upload' }))

    await waitFor(() =>
      expect(screen.getByText('first.pdf')).toBeInTheDocument()
    )
    expect(mockToastError).toHaveBeenCalled()
    expect(screen.queryByText('second.pdf')).not.toBeInTheDocument()
    consoleErrorSpy.mockRestore()
  })
})
