import { describe, it, expect, vi } from 'vitest'
import {
  ContentType,
  ChatCompletionRole,
  MessageStatus,
} from '@ax-studio/core'
import {
  newUserThreadContent,
  newAssistantThreadContent,
  emptyThreadContent,
} from '../completion'
import type { Attachment } from '@/types/attachment'

// Mock ulid to return deterministic values
vi.mock('ulidx', () => {
  let counter = 0
  return {
    ulid: () => `MOCK_ULID_${++counter}`,
  }
})

// ─── A. SPEC TESTS ─────────────────────────────────────────────────────────

describe('newUserThreadContent', () => {
  it('creates a user message with correct role and structure', () => {
    const msg = newUserThreadContent('thread-1', 'Hello')
    expect(msg.role).toBe(ChatCompletionRole.User)
    expect(msg.thread_id).toBe('thread-1')
    expect(msg.object).toBe('thread.message')
    expect(msg.type).toBe('text')
    expect(msg.status).toBe(MessageStatus.Ready)
    expect(msg.created_at).toBe(0)
    expect(msg.completed_at).toBe(0)
  })

  it('creates text content with the provided message', () => {
    const msg = newUserThreadContent('t1', 'Hello world')
    expect(msg.content).toHaveLength(1)
    expect(msg.content[0].type).toBe(ContentType.Text)
    expect(msg.content[0].text?.value).toBe('Hello world')
    expect(msg.content[0].text?.annotations).toEqual([])
  })

  it('generates a ulid when no id is provided', () => {
    const msg = newUserThreadContent('t1', 'hi')
    expect(msg.id).toMatch(/^MOCK_ULID_/)
  })

  it('uses provided id when given', () => {
    const msg = newUserThreadContent('t1', 'hi', undefined, 'custom-id')
    expect(msg.id).toBe('custom-id')
  })

  it('returns undefined metadata when no inline documents', () => {
    const msg = newUserThreadContent('t1', 'hi')
    expect(msg.metadata).toBeUndefined()
  })

  it('returns undefined metadata when attachments are undefined', () => {
    const msg = newUserThreadContent('t1', 'hi', undefined)
    expect(msg.metadata).toBeUndefined()
  })

  it('returns undefined metadata when attachments is empty array', () => {
    const msg = newUserThreadContent('t1', 'hi', [])
    expect(msg.metadata).toBeUndefined()
  })

  it('adds image attachments as image content parts', () => {
    const images: Attachment[] = [
      {
        name: 'photo.png',
        type: 'image',
        base64: 'aGVsbG8=',
        mimeType: 'image/png',
      },
    ]
    const msg = newUserThreadContent('t1', 'see image', images)
    expect(msg.content).toHaveLength(2)
    expect(msg.content[1].type).toBe(ContentType.Image)
    expect((msg.content[1] as any).image_url.url).toBe(
      'data:image/png;base64,aGVsbG8='
    )
    expect((msg.content[1] as any).image_url.detail).toBe('auto')
  })

  it('skips image attachments without base64', () => {
    const images: Attachment[] = [
      { name: 'nodata.png', type: 'image', mimeType: 'image/png' },
    ]
    const msg = newUserThreadContent('t1', 'hi', images)
    expect(msg.content).toHaveLength(1) // only text part
  })

  it('skips image attachments without mimeType', () => {
    const images: Attachment[] = [
      { name: 'nodata.png', type: 'image', base64: 'abc' },
    ]
    const msg = newUserThreadContent('t1', 'hi', images)
    expect(msg.content).toHaveLength(1)
  })

  it('injects document metadata into text content', () => {
    const docs: Attachment[] = [
      {
        name: 'report.pdf',
        type: 'document',
        id: 'doc-1',
        fileType: 'pdf',
        injectionMode: 'embeddings',
      },
    ]
    const msg = newUserThreadContent('t1', 'analyze this', docs)
    const textValue = msg.content[0].text?.value ?? ''
    expect(textValue).toContain('[ATTACHED_FILES]')
    expect(textValue).toContain('file_id: doc-1')
    expect(textValue).toContain('name: report.pdf')
    expect(textValue).toContain('mode: embeddings')
  })

  it('uses document name as fallback id when id is missing', () => {
    const docs: Attachment[] = [
      {
        name: 'unnamed.txt',
        type: 'document',
        fileType: 'txt',
      },
    ]
    const msg = newUserThreadContent('t1', 'look', docs)
    const textValue = msg.content[0].text?.value ?? ''
    expect(textValue).toContain('file_id: unnamed.txt')
  })

  it('includes inline document content in metadata', () => {
    const docs: Attachment[] = [
      {
        name: 'inline.txt',
        type: 'document',
        id: 'doc-2',
        fileType: 'txt',
        injectionMode: 'inline',
        inlineContent: 'This is the file content',
      },
    ]
    const msg = newUserThreadContent('t1', 'read', docs)
    expect(msg.metadata).toBeDefined()
    const inlineContents = msg.metadata?.inline_file_contents as Array<{
      name: string
      content: string | undefined
    }>
    expect(inlineContents).toHaveLength(1)
    expect(inlineContents[0].name).toBe('inline.txt')
    expect(inlineContents[0].content).toBe('This is the file content')
  })

  it('does not include non-inline documents in metadata', () => {
    const docs: Attachment[] = [
      {
        name: 'embedded.pdf',
        type: 'document',
        id: 'doc-3',
        fileType: 'pdf',
        injectionMode: 'embeddings',
      },
    ]
    const msg = newUserThreadContent('t1', 'read', docs)
    expect(msg.metadata).toBeUndefined()
  })

  it('requires both injectionMode=inline AND inlineContent for metadata', () => {
    const docs: Attachment[] = [
      {
        name: 'noinline.txt',
        type: 'document',
        id: 'doc-4',
        injectionMode: 'inline',
        // no inlineContent
      },
    ]
    const msg = newUserThreadContent('t1', 'hi', docs)
    // The filter checks for doc.injectionMode === 'inline' && doc.inlineContent
    // Since inlineContent is undefined (falsy), this doc is excluded
    expect(msg.metadata).toBeUndefined()
  })

  it('handles mixed images and documents', () => {
    const attachments: Attachment[] = [
      {
        name: 'photo.jpg',
        type: 'image',
        base64: 'imgdata',
        mimeType: 'image/jpeg',
      },
      {
        name: 'doc.pdf',
        type: 'document',
        id: 'd1',
        fileType: 'pdf',
        injectionMode: 'embeddings',
      },
      {
        name: 'inline.md',
        type: 'document',
        id: 'd2',
        fileType: 'md',
        injectionMode: 'inline',
        inlineContent: '# Title',
      },
    ]
    const msg = newUserThreadContent('t1', 'review these', attachments)
    // 1 text + 1 image
    expect(msg.content).toHaveLength(2)
    // Text should contain file metadata
    expect(msg.content[0].text?.value).toContain('[ATTACHED_FILES]')
    // Metadata should contain inline doc
    expect(msg.metadata).toBeDefined()
    const inlineContents = msg.metadata?.inline_file_contents as Array<{
      name: string
      content: string | undefined
    }>
    expect(inlineContents).toHaveLength(1)
    expect(inlineContents[0].name).toBe('inline.md')
  })
})

describe('newAssistantThreadContent', () => {
  it('creates an assistant message with correct role and structure', () => {
    const msg = newAssistantThreadContent('thread-2', 'Hi there')
    expect(msg.role).toBe(ChatCompletionRole.Assistant)
    expect(msg.thread_id).toBe('thread-2')
    expect(msg.object).toBe('thread.message')
    expect(msg.type).toBe('text')
    expect(msg.status).toBe(MessageStatus.Ready)
    expect(msg.created_at).toBe(0)
    expect(msg.completed_at).toBe(0)
  })

  it('creates text content with the provided message', () => {
    const msg = newAssistantThreadContent('t1', 'response text')
    expect(msg.content).toHaveLength(1)
    expect(msg.content[0].type).toBe(ContentType.Text)
    expect(msg.content[0].text?.value).toBe('response text')
    expect(msg.content[0].text?.annotations).toEqual([])
  })

  it('generates a ulid when no id is provided', () => {
    const msg = newAssistantThreadContent('t1', 'hi')
    expect(msg.id).toMatch(/^MOCK_ULID_/)
  })

  it('uses provided id when given', () => {
    const msg = newAssistantThreadContent('t1', 'hi', {}, 'my-id')
    expect(msg.id).toBe('my-id')
  })

  it('uses empty object as default metadata', () => {
    const msg = newAssistantThreadContent('t1', 'hi')
    expect(msg.metadata).toEqual({})
  })

  it('passes through custom metadata', () => {
    const meta = { model: 'gpt-4', tokens: 150 }
    const msg = newAssistantThreadContent('t1', 'hi', meta)
    expect(msg.metadata).toBe(meta)
    expect(msg.metadata?.model).toBe('gpt-4')
    expect(msg.metadata?.tokens).toBe(150)
  })

  it('handles empty string content', () => {
    const msg = newAssistantThreadContent('t1', '')
    expect(msg.content[0].text?.value).toBe('')
  })

  it('handles content with special characters', () => {
    const content = 'Here is code: `const x = 1;`\n```js\nconsole.log("hi")\n```'
    const msg = newAssistantThreadContent('t1', content)
    expect(msg.content[0].text?.value).toBe(content)
  })
})

describe('emptyThreadContent', () => {
  it('has assistant role', () => {
    expect(emptyThreadContent.role).toBe(ChatCompletionRole.Assistant)
  })

  it('has empty content array', () => {
    expect(emptyThreadContent.content).toEqual([])
  })

  it('has empty thread_id', () => {
    expect(emptyThreadContent.thread_id).toBe('')
  })

  it('has ready status', () => {
    expect(emptyThreadContent.status).toBe(MessageStatus.Ready)
  })

  it('has a valid string id', () => {
    expect(typeof emptyThreadContent.id).toBe('string')
    expect(emptyThreadContent.id.length).toBeGreaterThan(0)
  })

  it('has object set to thread.message', () => {
    expect(emptyThreadContent.object).toBe('thread.message')
  })

  it('has type set to text', () => {
    expect(emptyThreadContent.type).toBe('text')
  })
})

// ─── B. ATTACK TESTS ───────────────────────────────────────────────────────

describe('completion adversarial inputs', () => {
  it('handles empty string content for user message', () => {
    const msg = newUserThreadContent('t1', '')
    expect(msg.content[0].text?.value).toBe('')
  })

  it('handles content with newlines and special chars', () => {
    const content = 'line1\nline2\ttab\r\nwindows'
    const msg = newUserThreadContent('t1', content)
    expect(msg.content[0].text?.value).toBe(content)
  })

  it('handles very long content strings', () => {
    const content = 'x'.repeat(100_000)
    const msg = newUserThreadContent('t1', content)
    expect(msg.content[0].text?.value).toHaveLength(100_000)
  })

  it('handles multiple images correctly', () => {
    const images: Attachment[] = Array.from({ length: 5 }, (_, i) => ({
      name: `img${i}.png`,
      type: 'image' as const,
      base64: `data${i}`,
      mimeType: 'image/png',
    }))
    const msg = newUserThreadContent('t1', 'pics', images)
    // 1 text + 5 images
    expect(msg.content).toHaveLength(6)
  })

  it('handles document with size=0 (falsy but valid)', () => {
    const docs: Attachment[] = [
      {
        name: 'empty.txt',
        type: 'document',
        id: 'd1',
        fileType: 'txt',
        size: 0,
      },
    ]
    const msg = newUserThreadContent('t1', 'look', docs)
    const textValue = msg.content[0].text?.value ?? ''
    expect(textValue).toContain('size: 0')
  })

  it('handles document with chunkCount=0', () => {
    const docs: Attachment[] = [
      {
        name: 'chunked.txt',
        type: 'document',
        id: 'd1',
        fileType: 'txt',
        chunkCount: 0,
      },
    ]
    const msg = newUserThreadContent('t1', 'look', docs)
    const textValue = msg.content[0].text?.value ?? ''
    expect(textValue).toContain('chunks: 0')
  })
})

// ─── C. PROPERTY TESTS ─────────────────────────────────────────────────────

describe('completion property invariants', () => {
  it('user message always has at least one content part', () => {
    const msg1 = newUserThreadContent('t1', '')
    expect(msg1.content.length).toBeGreaterThanOrEqual(1)

    const msg2 = newUserThreadContent('t1', 'text', [])
    expect(msg2.content.length).toBeGreaterThanOrEqual(1)
  })

  it('assistant message always has exactly one content part', () => {
    const msg = newAssistantThreadContent('t1', 'response')
    expect(msg.content).toHaveLength(1)
  })

  it('content part count equals 1 + valid image count', () => {
    const validImages: Attachment[] = [
      { name: 'a.png', type: 'image', base64: 'x', mimeType: 'image/png' },
      { name: 'b.jpg', type: 'image', base64: 'y', mimeType: 'image/jpeg' },
    ]
    const invalidImages: Attachment[] = [
      { name: 'c.png', type: 'image' }, // no base64/mimeType
    ]
    const msg = newUserThreadContent('t1', 'hi', [
      ...validImages,
      ...invalidImages,
    ])
    expect(msg.content).toHaveLength(1 + 2) // text + 2 valid images
  })

  it('user and assistant roles are distinct', () => {
    const user = newUserThreadContent('t1', 'hi')
    const asst = newAssistantThreadContent('t1', 'hi')
    expect(user.role).not.toBe(asst.role)
    expect(user.role).toBe('user')
    expect(asst.role).toBe('assistant')
  })

  it('each call to newUserThreadContent generates unique id', () => {
    const ids = new Set(
      Array.from({ length: 10 }, () => newUserThreadContent('t1', 'hi').id)
    )
    expect(ids.size).toBe(10)
  })

  it('each call to newAssistantThreadContent generates unique id', () => {
    const ids = new Set(
      Array.from({ length: 10 }, () =>
        newAssistantThreadContent('t1', 'hi').id
      )
    )
    expect(ids.size).toBe(10)
  })
})
