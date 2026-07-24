import { describe, it, expect, vi, beforeEach } from 'vitest'

const readFileSync = vi.hoisted(() => vi.fn())

vi.mock('@ax-studio/core', () => ({
  fs: { readFileSync },
}))

import {
  isLocallyReadableDocument,
  isLocallyReadableDocumentFromHints,
  normalizeDocumentExtension,
  parseLocalDocumentText,
  LOCAL_TEXT_DOCUMENT_EXTENSIONS,
} from '../local-parse'

describe('local document parse fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recognizes text-like extensions', () => {
    for (const ext of LOCAL_TEXT_DOCUMENT_EXTENSIONS) {
      expect(isLocallyReadableDocument(ext)).toBe(true)
      expect(isLocallyReadableDocument(`notes.${ext}`)).toBe(true)
    }
    expect(isLocallyReadableDocument('pdf')).toBe(false)
    expect(isLocallyReadableDocument('docx')).toBe(false)
  })

  it('normalizes extensions from path or type', () => {
    expect(normalizeDocumentExtension('TXT')).toBe('txt')
    expect(normalizeDocumentExtension('.md')).toBe('md')
    expect(normalizeDocumentExtension('/tmp/notes.CSV')).toBe('csv')
  })

  it('recognizes text documents from fallback hints', () => {
    expect(
      isLocallyReadableDocumentFromHints(
        'application/octet-stream',
        '/docs/model-comparison-prompts.md',
        'model-comparison-prompts.md'
      )
    ).toBe(true)
  })

  it('reads plain text files via fs.readFileSync', async () => {
    readFileSync.mockResolvedValueOnce('# Hello\n\nbody')
    const text = await parseLocalDocumentText('/docs/readme.md', 'md')
    expect(readFileSync).toHaveBeenCalledWith('/docs/readme.md')
    expect(text).toBe('# Hello\n\nbody')
  })

  it('falls back to the path when fileType is generic', async () => {
    readFileSync.mockResolvedValueOnce('# Hello from path fallback')
    const text = await parseLocalDocumentText(
      '/docs/readme.md',
      'application/octet-stream'
    )
    expect(readFileSync).toHaveBeenCalledWith('/docs/readme.md')
    expect(text).toBe('# Hello from path fallback')
  })

  it('returns empty string for binary types without reading', async () => {
    const text = await parseLocalDocumentText('/docs/report.pdf', 'pdf')
    expect(readFileSync).not.toHaveBeenCalled()
    expect(text).toBe('')
  })

  it('returns empty string when read fails', async () => {
    readFileSync.mockRejectedValueOnce(new Error('ENOENT'))
    const text = await parseLocalDocumentText('/missing.txt', 'txt')
    expect(text).toBe('')
  })
})
