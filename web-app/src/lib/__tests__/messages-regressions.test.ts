import { describe, expect, it } from 'vitest'
import { ContentType, type ThreadMessage } from '@ax-studio/core'
import {
  CompletionMessagesBuilder,
  convertThreadMessageToUIMessage,
} from '../messages'

describe('messages regressions', () => {
  it('serializes multimodal tool results into string tool content', () => {
    const builder = new CompletionMessagesBuilder([])

    builder.addToolMessage(
      {
        content: [
          {
            type: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
          },
        ],
      },
      'tool-call-1'
    )

    const result = builder.getMessages()
    expect(result[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'tool-call-1',
    })
    expect(typeof result[1].content).toBe('string')
    expect(result[1].content).toContain('image/png')
  })

  it('preserves image media types when converting thread messages to UI messages', () => {
    const threadMessage: ThreadMessage = {
      id: 'msg-1',
      object: 'thread.message',
      thread_id: 'thread-1',
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
      status: 'completed',
      created_at: Date.now(),
      completed_at: Date.now(),
    }

    const uiMessage = convertThreadMessageToUIMessage(threadMessage)

    expect(uiMessage.parts[0]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      url: 'data:image/png;base64,abc123',
    })
  })
})
