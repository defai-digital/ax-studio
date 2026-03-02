import { describe, expect, it } from 'vitest'
import { ContentType, MessageStatus, type ThreadMessage } from '@ax-fabric/core'
import type { ThreadFolder } from '@/services/projects/types'
import {
  buildWorkspaceChatsExportData,
  workspaceChatsToAlpacaJson,
  workspaceChatsToCsv,
  workspaceChatsToJson,
  workspaceChatsToOpenAIJsonl,
} from '@/lib/workspace-chat-export'

const workspace: ThreadFolder = {
  id: 'workspace-1',
  name: 'Sales Workspace',
  updated_at: 1_736_200_000_000,
}

const threads = [
  {
    id: 'thread-1',
    title: 'Lead follow-up',
    updated: 1_736_200_000_000,
  },
]

const messages: ThreadMessage[] = [
  {
    id: 'msg-1',
    object: 'thread.message',
    thread_id: 'thread-1',
    role: 'system',
    content: [
      {
        type: ContentType.Text,
        text: { value: 'You are a helpful sales assistant.', annotations: [] },
      },
    ],
    status: MessageStatus.Ready,
    created_at: 1_736_200_000_000,
    completed_at: 1_736_200_000_100,
  },
  {
    id: 'msg-2',
    object: 'thread.message',
    thread_id: 'thread-1',
    role: 'user',
    content: [
      {
        type: ContentType.Text,
        text: { value: 'Draft a short follow-up email.', annotations: [] },
      },
    ],
    status: MessageStatus.Ready,
    created_at: 1_736_200_001_000,
    completed_at: 0,
  },
  {
    id: 'msg-3',
    object: 'thread.message',
    thread_id: 'thread-1',
    role: 'assistant',
    content: [
      {
        type: ContentType.Text,
        text: {
          value: 'Hi Sam,\n\nJust checking in after our last call.',
          annotations: [],
        },
      },
    ],
    status: MessageStatus.Ready,
    created_at: 1_736_200_002_000,
    completed_at: 1_736_200_002_100,
  },
]

describe('workspace chat export', () => {
  it('exports workspace chats to json', () => {
    const exportData = buildWorkspaceChatsExportData(workspace, threads, {
      'thread-1': messages,
    })
    const json = workspaceChatsToJson(exportData)
    const parsed = JSON.parse(json)

    expect(parsed.workspace.name).toBe('Sales Workspace')
    expect(parsed.threads[0].messages[2].content).toContain(
      'Just checking in after our last call.'
    )
  })

  it('exports workspace chats to csv with escaped content', () => {
    const exportData = buildWorkspaceChatsExportData(workspace, threads, {
      'thread-1': messages,
    })
    const csv = workspaceChatsToCsv(exportData)
    const userRow = csv.split('\n').find((line) => line.includes('msg-2'))

    expect(csv).toContain('workspace_id,workspace_name,thread_id')
    expect(csv).toContain('"Hi Sam,\n\nJust checking in after our last call."')
    expect(userRow).toBeDefined()
    expect(userRow?.split(',')[8]).toBe('')
    expect(csv).not.toContain('1970-01-01T00:00:00.000Z')
  })

  it('exports workspace chats to alpaca json and openai jsonl', () => {
    const exportData = buildWorkspaceChatsExportData(workspace, threads, {
      'thread-1': messages,
    })
    const alpaca = JSON.parse(workspaceChatsToAlpacaJson(exportData))
    const openaiJsonl = workspaceChatsToOpenAIJsonl(exportData)
    const openaiLine = JSON.parse(openaiJsonl.split('\n')[0])

    expect(alpaca[0]).toMatchObject({
      instruction: 'You are a helpful sales assistant.',
      input: 'Draft a short follow-up email.',
    })
    expect(openaiLine.messages).toHaveLength(3)
    expect(openaiLine.metadata.workspace_id).toBe('workspace-1')
  })
})
