import { describe, expect, it } from 'vitest'
import { ContentType, type ThreadMessage } from '@ax-studio/core'
import type { UIMessage } from '@ai-sdk/react'
import {
  convertThreadMessageToUIMessage,
  extractContentPartsFromUIMessage,
} from '../messages'

describe('messages regressions', () => {
  const makeThreadMessage = (
    overrides: Partial<ThreadMessage>
  ): ThreadMessage => ({
    id: 'msg-1',
    object: 'thread.message',
    thread_id: 'thread-1',
    role: 'assistant',
    content: [],
    status: 'completed',
    created_at: 1000,
    completed_at: 1000,
    ...overrides,
  })

  it('converts image message content into file parts', () => {
    const threadMessage = makeThreadMessage({
      role: 'user',
      content: [
        {
          type: ContentType.Image,
          image_url: {
            url: 'data:image/png;base64,abc123',
            detail: 'auto',
          },
        },
      ],
    })

    const uiMessage = convertThreadMessageToUIMessage(threadMessage)

    expect(uiMessage.parts[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,abc123',
    })
  })

  it('splits legacy completed think tags into reasoning and text parts', () => {
    const uiMessage = convertThreadMessageToUIMessage(
      makeThreadMessage({
        content: [
          {
            type: ContentType.Text,
            text: {
              value: '<think>plan first</think>\n\nfinal answer',
              annotations: [],
            },
          },
        ],
      })
    )

    expect(uiMessage.parts).toEqual([
      { type: 'reasoning', text: 'plan first' },
      { type: 'text', text: 'final answer' },
    ])
  })

  it('keeps old metadata tool calls with parsed input and string output', () => {
    const uiMessage = convertThreadMessageToUIMessage(
      makeThreadMessage({
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Result is ready', annotations: [] },
          },
        ],
        metadata: {
          tool_calls: [
            {
              tool: {
                id: 'call-1',
                function: {
                  name: 'search',
                  arguments: '{"query":"ax studio"}',
                },
              },
              response: {
                content: [{ type: 'text', text: 'Found it' }],
              },
            },
          ],
        },
      })
    )

    expect(uiMessage.parts.at(-1)).toEqual({
      type: 'tool-search',
      toolCallId: 'call-1',
      input: { query: 'ax studio' },
      state: 'output-available',
      output: 'Found it',
    })
  })

  it('extracts text, reasoning, image, and tool parts for persistence', () => {
    const uiMessage = {
      id: 'ui-1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'chain summary' },
        { type: 'text', text: 'Visible answer' },
        {
          type: 'file',
          mediaType: 'image/webp',
          url: 'https://example.test/render.webp',
        },
        {
          type: 'tool-search',
          toolCallId: 'call-2',
          input: { q: 'coverage' },
          output: { ok: true },
        },
      ],
    } as unknown as UIMessage

    expect(extractContentPartsFromUIMessage(uiMessage)).toEqual([
      {
        type: ContentType.Reasoning,
        text: { value: 'chain summary', annotations: [] },
      },
      {
        type: ContentType.Text,
        text: { value: 'Visible answer', annotations: [] },
      },
      {
        type: ContentType.Image,
        image_url: {
          url: 'https://example.test/render.webp',
          detail: 'auto',
        },
      },
      {
        type: ContentType.ToolCall,
        tool_call_id: 'call-2',
        tool_name: 'search',
        input: { q: 'coverage' },
        output: { ok: true },
      },
    ])
  })

  it('splits completed analysis-channel markers into reasoning and text', () => {
    const uiMessage = convertThreadMessageToUIMessage(
      makeThreadMessage({
        content: [
          {
            type: ContentType.Text,
            text: {
              value:
                '<|channel|>analysis<|message|>think hard<|start|>assistant<|channel|>final<|message|>answer',
              annotations: [],
            },
          },
        ],
      })
    )

    expect(uiMessage.parts).toEqual([
      { type: 'reasoning', text: 'think hard' },
      { type: 'text', text: 'answer' },
    ])
  })

  it('keeps in-progress analysis-channel body as reasoning', () => {
    const uiMessage = convertThreadMessageToUIMessage(
      makeThreadMessage({
        content: [
          {
            type: ContentType.Text,
            text: {
              value: '<|channel|>analysis<|message|>partial reasoning',
              annotations: [],
            },
          },
        ],
      })
    )

    expect(uiMessage.parts).toEqual([
      { type: 'reasoning', text: 'partial reasoning' },
    ])
  })

  it('detects image media type from URLs with query strings and hashes', () => {
    const withQuery = convertThreadMessageToUIMessage(
      makeThreadMessage({
        role: 'user',
        content: [
          {
            type: ContentType.Image,
            image_url: {
              url: 'https://cdn.example.com/shot.png?token=abc',
              detail: 'auto',
            },
          },
        ],
      })
    )
    expect(withQuery.parts[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
    })

    const withHash = convertThreadMessageToUIMessage(
      makeThreadMessage({
        role: 'user',
        content: [
          {
            type: ContentType.Image,
            image_url: {
              url: 'https://cdn.example.com/shot.webp#preview',
              detail: 'auto',
            },
          },
        ],
      })
    )
    expect(withHash.parts[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/webp',
    })
  })

  it('persists tool-invocation parts using toolName, not "invocation"', () => {
    const uiMessage = {
      id: 'ui-tool-inv',
      role: 'assistant',
      parts: [
        {
          type: 'tool-invocation',
          toolName: 'web_search',
          toolInvocationId: 't1',
          input: { q: 'ax' },
          output: { hits: 1 },
        },
      ],
    } as unknown as UIMessage

    expect(extractContentPartsFromUIMessage(uiMessage)).toEqual([
      {
        type: ContentType.ToolCall,
        tool_call_id: 't1',
        tool_name: 'web_search',
        input: { q: 'ax' },
        output: { hits: 1 },
      },
    ])
  })

  it('preserves falsy tool input/output instead of falling back to aliases', () => {
    const uiMessage = {
      id: 'ui-tool-falsy',
      role: 'assistant',
      parts: [
        {
          type: 'tool-search',
          toolCallId: 't-empty',
          input: '',
          args: { q: 'should-not-win' },
          output: '',
          result: 'stale',
        },
        {
          type: 'tool-count',
          toolCallId: 't-zero',
          input: 0,
          args: 99,
          output: 0,
          result: 42,
        },
      ],
    } as unknown as UIMessage

    expect(extractContentPartsFromUIMessage(uiMessage)).toEqual([
      {
        type: ContentType.ToolCall,
        tool_call_id: 't-empty',
        tool_name: 'search',
        input: '',
        output: '',
      },
      {
        type: ContentType.ToolCall,
        tool_call_id: 't-zero',
        tool_name: 'count',
        input: 0,
        output: 0,
      },
    ])
  })
})
