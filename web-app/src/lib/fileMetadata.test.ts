import { describe, it, expect } from 'vitest'
import {
  injectFilesIntoPrompt,
  extractFilesFromPrompt,
  FileMetadata,
} from './fileMetadata'

// ─── A. SPEC TESTS ─────────────────────────────────────────────────────────

describe('injectFilesIntoPrompt', () => {
  it('returns prompt unchanged when files array is empty', () => {
    const result = injectFilesIntoPrompt('hello world', [])
    expect(result).toBe('hello world')
  })

  it('returns prompt unchanged when files is falsy (null cast)', () => {
    const result = injectFilesIntoPrompt(
      'hello',
      null as unknown as FileMetadata[]
    )
    expect(result).toBe('hello')
  })

  it('appends a single file with only required fields', () => {
    const result = injectFilesIntoPrompt('prompt', [
      { id: 'abc', name: 'test.pdf' },
    ])
    expect(result).toContain('[ATTACHED_FILES]')
    expect(result).toContain('[/ATTACHED_FILES]')
    expect(result).toContain('file_id: abc')
    expect(result).toContain('name: test.pdf')
    expect(result).not.toContain('type:')
    expect(result).not.toContain('size:')
    expect(result).not.toContain('chunks:')
    expect(result).not.toContain('mode:')
  })

  it('includes all optional fields when provided', () => {
    const result = injectFilesIntoPrompt('p', [
      {
        id: 'x',
        name: 'doc.pdf',
        type: 'application/pdf',
        size: 1024,
        chunkCount: 5,
        injectionMode: 'inline',
      },
    ])
    expect(result).toContain('type: application/pdf')
    expect(result).toContain('size: 1024')
    expect(result).toContain('chunks: 5')
    expect(result).toContain('mode: inline')
  })

  it('handles multiple files with newline separation', () => {
    const result = injectFilesIntoPrompt('p', [
      { id: '1', name: 'a.txt' },
      { id: '2', name: 'b.txt' },
    ])
    const lines = result.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(2)
  })

  it('does not include size when size is 0 (falsy but valid number)', () => {
    const result = injectFilesIntoPrompt('p', [
      { id: '1', name: 'a.txt', size: 0 },
    ])
    // size 0 is typeof number, so it should be included
    expect(result).toContain('size: 0')
  })

  it('preserves original prompt text before the metadata block', () => {
    const prompt = 'Hello, how are you?\nI have a question.'
    const result = injectFilesIntoPrompt(prompt, [
      { id: '1', name: 'f.txt' },
    ])
    expect(result.startsWith(prompt)).toBe(true)
  })
})

describe('extractFilesFromPrompt', () => {
  it('returns empty files and original prompt when no metadata block', () => {
    const { files, cleanPrompt } = extractFilesFromPrompt('just text')
    expect(files).toHaveLength(0)
    expect(cleanPrompt).toBe('just text')
  })

  it('extracts a single file with required fields', () => {
    const input =
      'hello\n\n[ATTACHED_FILES]\n- file_id: abc, name: test.pdf\n[/ATTACHED_FILES]'
    const { files, cleanPrompt } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe('abc')
    expect(files[0].name).toBe('test.pdf')
    expect(cleanPrompt).toBe('hello')
  })

  it('extracts all optional fields', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: x, name: d.pdf, type: application/pdf, size: 2048, chunks: 10, mode: embeddings\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    expect(files[0].type).toBe('application/pdf')
    expect(files[0].size).toBe(2048)
    expect(files[0].chunkCount).toBe(10)
    expect(files[0].injectionMode).toBe('embeddings')
  })

  it('skips lines missing required file_id', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- name: orphan.pdf\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(0)
  })

  it('skips lines missing required name', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: lonely\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(0)
  })

  it('returns original prompt when end tag is missing', () => {
    const input = 'hello\n\n[ATTACHED_FILES]\n- file_id: a, name: b.txt'
    const { files, cleanPrompt } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(0)
    expect(cleanPrompt).toBe(input)
  })

  it('returns original prompt when end tag appears before start tag', () => {
    const input = '[/ATTACHED_FILES]\n[ATTACHED_FILES]'
    const { files, cleanPrompt } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(0)
    expect(cleanPrompt).toBe(input)
  })

  it('handles empty prompt string', () => {
    const { files, cleanPrompt } = extractFilesFromPrompt('')
    expect(files).toHaveLength(0)
    expect(cleanPrompt).toBe('')
  })

  it('rejects invalid injectionMode values', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: x, name: f.txt, mode: hacked\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    expect(files[0].injectionMode).toBeUndefined()
  })

  it('handles NaN size gracefully', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: x, name: f.txt, size: notanumber\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    expect(files[0].size).toBeUndefined()
  })

  it('handles NaN chunks gracefully', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: x, name: f.txt, chunks: abc\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    expect(files[0].chunkCount).toBeUndefined()
  })

  it('extracts multiple files', () => {
    const input =
      'msg\n\n[ATTACHED_FILES]\n- file_id: 1, name: a.txt\n- file_id: 2, name: b.txt\n- file_id: 3, name: c.txt\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(3)
    expect(files.map((f) => f.id)).toEqual(['1', '2', '3'])
  })
})

// ─── B. ATTACK TESTS ───────────────────────────────────────────────────────

describe('fileMetadata adversarial inputs', () => {
  it('handles file_id containing colons (e.g. URN)', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: urn:uuid:123, name: f.txt\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe('urn:uuid:123')
  })

  it('DISCOVERED BUG: file name containing commas is truncated', () => {
    // This is a known limitation of the comma-based parser
    const injected = injectFilesIntoPrompt('p', [
      { id: '1', name: 'report,final,v2.csv' },
    ])
    const { files } = extractFilesFromPrompt(injected)
    // The name gets truncated at the first comma because the parser
    // splits on commas without any escaping
    expect(files).toHaveLength(1)
    // The name will be truncated to just "report" since " final" becomes
    // a separate part that doesn't match any key, and "v2.csv" likewise
    expect(files[0].name).not.toBe('report,final,v2.csv')
    expect(files[0].name).toBe('report')
  })

  it('handles unicode in file names', () => {
    const { files } = extractFilesFromPrompt(
      'hi\n\n[ATTACHED_FILES]\n- file_id: 1, name: \u6587\u4EF6.pdf\n[/ATTACHED_FILES]'
    )
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('\u6587\u4EF6.pdf')
  })

  it('handles XSS-like content in file names', () => {
    const name = '<script>alert("xss")</script>'
    const injected = injectFilesIntoPrompt('p', [{ id: '1', name }])
    const { files } = extractFilesFromPrompt(injected)
    expect(files).toHaveLength(1)
    // The name is passed through as-is (no sanitization in this layer)
    expect(files[0].name).toBe(name)
  })

  it('handles prompt that contains marker text in user content', () => {
    const prompt = 'Please explain [ATTACHED_FILES] syntax'
    const { files, cleanPrompt } = extractFilesFromPrompt(prompt)
    // No end tag, so should return unchanged
    expect(files).toHaveLength(0)
    expect(cleanPrompt).toBe(prompt)
  })

  it('handles empty lines inside the metadata block', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n\n- file_id: 1, name: a.txt\n\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    // Empty lines should be skipped (no file_id or name)
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe('1')
  })

  it('handles size value of negative number', () => {
    const input =
      'hi\n\n[ATTACHED_FILES]\n- file_id: 1, name: f.txt, size: -5\n[/ATTACHED_FILES]'
    const { files } = extractFilesFromPrompt(input)
    expect(files).toHaveLength(1)
    // -5 is a valid number, not NaN, so it gets stored
    expect(files[0].size).toBe(-5)
  })

  it('strips whitespace from clean prompt', () => {
    const input =
      '  hello  \n\n[ATTACHED_FILES]\n- file_id: 1, name: a.txt\n[/ATTACHED_FILES]'
    const { cleanPrompt } = extractFilesFromPrompt(input)
    expect(cleanPrompt).toBe('hello')
  })
})

// ─── C. PROPERTY / ROUND-TRIP TESTS ────────────────────────────────────────

describe('fileMetadata round-trip properties', () => {
  it('inject then extract recovers all fields for simple values', () => {
    const original: FileMetadata = {
      id: 'file-001',
      name: 'report.pdf',
      type: 'application/pdf',
      size: 4096,
      chunkCount: 12,
      injectionMode: 'embeddings',
    }
    const injected = injectFilesIntoPrompt('Ask about this file', [original])
    const { files, cleanPrompt } = extractFilesFromPrompt(injected)
    expect(cleanPrompt).toBe('Ask about this file')
    expect(files).toHaveLength(1)
    expect(files[0]).toEqual(original)
  })

  it('inject then extract with multiple files preserves order', () => {
    const originals: FileMetadata[] = [
      { id: 'a', name: 'first.txt' },
      { id: 'b', name: 'second.txt', injectionMode: 'inline' },
      { id: 'c', name: 'third.txt', size: 100 },
    ]
    const injected = injectFilesIntoPrompt('multi', originals)
    const { files } = extractFilesFromPrompt(injected)
    expect(files).toHaveLength(3)
    expect(files[0].id).toBe('a')
    expect(files[1].id).toBe('b')
    expect(files[1].injectionMode).toBe('inline')
    expect(files[2].id).toBe('c')
    expect(files[2].size).toBe(100)
  })

  it('extracting from a clean prompt is idempotent', () => {
    const prompt = 'no files here'
    const first = extractFilesFromPrompt(prompt)
    const second = extractFilesFromPrompt(first.cleanPrompt)
    expect(second.files).toHaveLength(0)
    expect(second.cleanPrompt).toBe(prompt)
  })

  it('inject with empty prompt produces extractable result', () => {
    const injected = injectFilesIntoPrompt('', [
      { id: '1', name: 'x.txt' },
    ])
    const { files, cleanPrompt } = extractFilesFromPrompt(injected)
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe('1')
    expect(cleanPrompt).toBe('')
  })

  it('optional fields omitted during inject are undefined after extract', () => {
    const injected = injectFilesIntoPrompt('p', [
      { id: 'min', name: 'minimal.txt' },
    ])
    const { files } = extractFilesFromPrompt(injected)
    expect(files[0].type).toBeUndefined()
    expect(files[0].size).toBeUndefined()
    expect(files[0].chunkCount).toBeUndefined()
    expect(files[0].injectionMode).toBeUndefined()
  })
})
