import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFileSync = vi.hoisted(() => vi.fn())

vi.mock('@ax-studio/core', () => ({
  fs: { readFileSync },
}))

import {
  extractDocumentText,
  isLocallyExtractableBinaryDocument,
  LOCALLY_EXTRACTABLE_BINARY_EXTENSIONS,
} from '../document-extraction'
import type { CoreService } from '@/services/core/types'

describe('document extraction compatibility layer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recognizes every locally extractable binary format', () => {
    for (const extension of LOCALLY_EXTRACTABLE_BINARY_EXTENSIONS) {
      expect(isLocallyExtractableBinaryDocument(extension)).toBe(true)
      expect(
        isLocallyExtractableBinaryDocument(`/documents/report.${extension}`)
      ).toBe(true)
    }
    expect(isLocallyExtractableBinaryDocument('md')).toBe(false)
  })

  it('keeps text attachments on the existing UTF-8 path', async () => {
    const core = {
      invoke: vi.fn(),
    } as unknown as CoreService
    readFileSync.mockResolvedValueOnce('# Notes')

    const result = await extractDocumentText({
      path: '/documents/notes.md',
      fileType: 'md',
      core,
    })

    expect(result.text).toBe('# Notes')
    expect(result.metadata.format).toBe('md')
    expect(core.invoke).not.toHaveBeenCalled()
  })

  it('invokes the bounded native extractor for binary documents', async () => {
    const nativeResult = {
      text: '## Page 1\n\nQuarterly report',
      metadata: { format: 'pdf', unitCount: 1, truncated: false },
      warnings: [],
    }
    const core = {
      invoke: vi.fn().mockResolvedValue(nativeResult),
    } as unknown as CoreService

    await expect(
      extractDocumentText({
        path: '/documents/report.pdf',
        fileType: 'pdf',
        core,
      })
    ).resolves.toEqual(nativeResult)
    expect(core.invoke).toHaveBeenCalledWith('extract_document_text', {
      path: '/documents/report.pdf',
      fileType: 'pdf',
    })
  })

  it('does not attempt binary extraction without a native core service', async () => {
    const result = await extractDocumentText({
      path: '/documents/report.pdf',
      fileType: 'pdf',
    })

    expect(result.text).toBe('')
    expect(readFileSync).not.toHaveBeenCalled()
  })

  it('rejects malformed native responses', async () => {
    const core = {
      invoke: vi.fn().mockResolvedValue({ text: 42 }),
    } as unknown as CoreService

    await expect(
      extractDocumentText({
        path: '/documents/report.pdf',
        fileType: 'pdf',
        core,
      })
    ).rejects.toThrow('invalid response')
  })
})
