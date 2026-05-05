import { describe, expect, it } from 'vitest'
import { ContentType, type ThreadMessage } from '@ax-studio/core'
import { convertThreadMessageToUIMessage } from '../messages'

describe('messages regressions', () => {
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
