import { describe, it, expect } from 'vitest'
import { ContentType, type ThreadMessage } from '@ax-studio/core'
import type { UIMessage } from '@ai-sdk/react'
import {
  convertThreadMessageToUIMessage,
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
} from '../index'

function makeThread(content: ThreadMessage['content'], role: string = 'assistant'): ThreadMessage {
  return { id: 'm1', role, content } as ThreadMessage
}

// ─── convertThreadMessageToUIMessage ────────────────────────────────────────

describe('convertThreadMessageToUIMessage', () => {
  it('converts a plain text message', () => {
    const msg = makeThread([{ type: ContentType.Text, text: { value: 'Hello', annotations: [] } }])
    const ui = convertThreadMessageToUIMessage(msg)
    expect(ui.role).toBe('assistant')
    expect(ui.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Hello' }))
  })

  it('converts a reasoning content block', () => {
    const msg = makeThread([{ type: ContentType.Reasoning, text: { value: 'thinking...', annotations: [] } }])
    const ui = convertThreadMessageToUIMessage(msg)
    expect(ui.parts).toContainEqual(expect.objectContaining({ type: 'reasoning', text: 'thinking...' }))
  })

  it('promotes in-progress <think> tags to reasoning parts', () => {
    const msg = makeThread([
      { type: ContentType.Text, text: { value: '<think>partial reasoning', annotations: [] } },
    ])
    const ui = convertThreadMessageToUIMessage(msg)
    const reasoningPart = ui.parts?.find((p) => p.type === 'reasoning')
    expect(reasoningPart).toBeDefined()
  })

  it('splits completed <think>…</think> into reasoning + text parts', () => {
    const msg = makeThread([
      { type: ContentType.Text, text: { value: '<think>reasoning</think>answer', annotations: [] } },
    ])
    const ui = convertThreadMessageToUIMessage(msg)
    const parts = ui.parts ?? []
    expect(parts.some((p) => p.type === 'reasoning')).toBe(true)
    expect(parts.some((p) => p.type === 'text')).toBe(true)
  })

  it('converts an image content block to a file part', () => {
    const msg = makeThread([
      {
        type: ContentType.Image,
        image_url: { url: 'data:image/png;base64,abc=' },
      } as never,
    ])
    const ui = convertThreadMessageToUIMessage(msg)
    expect(ui.parts).toContainEqual(expect.objectContaining({ type: 'file' }))
  })

  it('handles empty content array without error', () => {
    const msg = makeThread([])
    expect(() => convertThreadMessageToUIMessage(msg)).not.toThrow()
  })

  it('handles undefined content without error', () => {
    const msg = makeThread(undefined)
    const ui = convertThreadMessageToUIMessage(msg)
    expect(ui).toBeDefined()
  })
})

// ─── convertThreadMessagesToUIMessages ──────────────────────────────────────

describe('convertThreadMessagesToUIMessages', () => {
  it('maps an array of messages and filters nulls', () => {
    const messages = [
      makeThread([{ type: ContentType.Text, text: { value: 'a', annotations: [] } }]),
      makeThread([{ type: ContentType.Text, text: { value: 'b', annotations: [] } }]),
    ]
    const result = convertThreadMessagesToUIMessages(messages)
    expect(result).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(convertThreadMessagesToUIMessages([])).toEqual([])
  })
})

// ─── extractContentPartsFromUIMessage ───────────────────────────────────────

describe('extractContentPartsFromUIMessage', () => {
  function makeUI(parts: UIMessage['parts']): UIMessage {
    return { id: 'm1', role: 'assistant', content: '', parts } as UIMessage
  }

  it('extracts a text part as text ThreadContent', () => {
    const ui = makeUI([{ type: 'text', text: 'hello' }])
    const content = extractContentPartsFromUIMessage(ui)
    expect(content).toContainEqual(
      expect.objectContaining({ type: ContentType.Text })
    )
  })

  it('extracts a reasoning part as reasoning ThreadContent', () => {
    const ui = makeUI([{ type: 'reasoning', reasoning: 'deep thought', text: '' } as never])
    const content = extractContentPartsFromUIMessage(ui)
    expect(content).toContainEqual(
      expect.objectContaining({ type: ContentType.Reasoning })
    )
  })

  it('splits <think>-tagged text into reasoning + text ThreadContent items', () => {
    const ui = makeUI([{ type: 'text', text: '<think>step</think>answer' }])
    const content = extractContentPartsFromUIMessage(ui)
    expect(content.some((c) => c.type === ContentType.Reasoning)).toBe(true)
    expect(content.some((c) => c.type === ContentType.Text)).toBe(true)
  })

  it('falls back to an empty-text item when no non-empty text part exists', () => {
    // Empty text in a part produces no text ThreadContent — the function
    // guarantees at least one item (empty text sentinel) so callers always
    // have a content array to persist.
    const ui = makeUI([{ type: 'text', text: '' }])
    const content = extractContentPartsFromUIMessage(ui)
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe(ContentType.Text)
  })

  it('returns the empty-text sentinel when parts is missing', () => {
    // The function guarantees a non-empty array so downstream persists
    // always have at least one content item.
    const ui = makeUI(undefined)
    expect(() => extractContentPartsFromUIMessage(ui)).not.toThrow()
    const content = extractContentPartsFromUIMessage(ui)
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe(ContentType.Text)
  })

  it('extracts tool-result parts', () => {
    const ui = makeUI([
      {
        type: 'tool-invocation',
        toolInvocationId: 'tid-1',
        toolName: 'web_search',
        state: 'result',
        input: { query: 'test' },
        output: { data: 'result' },
      } as never,
    ])
    const content = extractContentPartsFromUIMessage(ui)
    // Should include a tool call content item
    expect(content.length).toBeGreaterThan(0)
  })
})
