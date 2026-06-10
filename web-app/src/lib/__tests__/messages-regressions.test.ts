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
})
