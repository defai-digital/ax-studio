import { ContentType, type ThreadMessage } from '@ax-fabric/core'
import type { ThreadFolder } from '@/services/projects/types'

export type WorkspaceChatExportFormat = 'csv' | 'json' | 'alpaca' | 'openai-jsonl'

export interface WorkspaceThreadLike {
  id: string
  title: string
  updated: number
}

export interface WorkspaceChatExportMessage {
  id: string
  role: string
  content: string
  created_at: number
  completed_at: number
  status: string
}

export interface WorkspaceChatExportThread {
  id: string
  title: string
  updated: number
  messages: WorkspaceChatExportMessage[]
}

export interface WorkspaceChatsExportData {
  workspace: {
    id: string
    name: string
  }
  exported_at: string
  threads: WorkspaceChatExportThread[]
}

const toIsoDate = (timestamp: number): string => {
  const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  return new Date(normalized).toISOString()
}

const toIsoDateOrEmpty = (timestamp: number): string => {
  if (!timestamp) return ''
  return toIsoDate(timestamp)
}

const escapeCsv = (value: unknown): string => {
  const raw = value == null ? '' : String(value)
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

const stringifyToolPart = (input: unknown, output: unknown): string => {
  const parts: string[] = []
  if (input !== undefined) {
    parts.push(`Input: ${JSON.stringify(input)}`)
  }
  if (output !== undefined) {
    parts.push(`Output: ${JSON.stringify(output)}`)
  }
  return parts.join('\n')
}

export const extractThreadMessageText = (message: ThreadMessage): string => {
  if (!Array.isArray(message.content)) return ''

  const parts = message.content
    .map((contentPart) => {
      if (
        contentPart.type === ContentType.Text ||
        contentPart.type === ContentType.Reasoning
      ) {
        return contentPart.text?.value ?? ''
      }

      if (contentPart.type === ContentType.Image) {
        return contentPart.image_url?.url
          ? `[Image] ${contentPart.image_url.url}`
          : '[Image]'
      }

      if (contentPart.type === ContentType.ToolCall) {
        const toolName =
          contentPart.tool_name ?? contentPart.tool_call_id ?? 'tool_call'
        const details = stringifyToolPart(contentPart.input, contentPart.output)
        return details ? `[Tool: ${toolName}]\n${details}` : `[Tool: ${toolName}]`
      }

      return ''
    })
    .filter(Boolean)

  return parts.join('\n\n').trim()
}

export const buildWorkspaceChatsExportData = (
  workspace: ThreadFolder,
  threads: WorkspaceThreadLike[],
  messagesByThreadId: Record<string, ThreadMessage[]>
): WorkspaceChatsExportData => {
  const exportThreads = threads
    .slice()
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
    .map((thread) => {
      const threadMessages = (messagesByThreadId[thread.id] ?? [])
        .slice()
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: extractThreadMessageText(message),
          created_at: message.created_at ?? 0,
          completed_at: message.completed_at ?? 0,
          status: message.status ?? '',
        }))

      return {
        id: thread.id,
        title: thread.title,
        updated: thread.updated ?? 0,
        messages: threadMessages,
      }
    })

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    exported_at: new Date().toISOString(),
    threads: exportThreads,
  }
}

export const workspaceChatsToJson = (data: WorkspaceChatsExportData): string =>
  JSON.stringify(data, null, 2)

export const workspaceChatsToCsv = (data: WorkspaceChatsExportData): string => {
  const rows: string[] = [
    'workspace_id,workspace_name,thread_id,thread_title,thread_updated,message_id,message_role,message_created,message_completed,message_status,message_content',
  ]

  data.threads.forEach((thread) => {
    const threadUpdated = toIsoDate(thread.updated || 0)
    thread.messages.forEach((message) => {
      rows.push(
        [
          data.workspace.id,
          data.workspace.name,
          thread.id,
          thread.title,
          threadUpdated,
          message.id,
          message.role,
          toIsoDate(message.created_at || 0),
          toIsoDateOrEmpty(message.completed_at || 0),
          message.status,
          message.content,
        ]
          .map(escapeCsv)
          .join(',')
      )
    })
  })

  return rows.join('\n')
}

export const workspaceChatsToAlpacaJson = (
  data: WorkspaceChatsExportData
): string => {
  const rows: Array<{
    instruction: string
    input: string
    output: string
    metadata: {
      workspace_id: string
      thread_id: string
      thread_title: string
    }
  }> = []

  data.threads.forEach((thread) => {
    const systemPrompt = thread.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n')
      .trim()

    let pendingInput = ''
    thread.messages.forEach((message) => {
      if (message.role === 'user' && message.content) {
        pendingInput = pendingInput
          ? `${pendingInput}\n${message.content}`
          : message.content
      }

      if (message.role === 'assistant' && message.content) {
        rows.push({
          instruction: systemPrompt || thread.title,
          input: pendingInput,
          output: message.content,
          metadata: {
            workspace_id: data.workspace.id,
            thread_id: thread.id,
            thread_title: thread.title,
          },
        })
        pendingInput = ''
      }
    })
  })

  return JSON.stringify(rows, null, 2)
}

export const workspaceChatsToOpenAIJsonl = (
  data: WorkspaceChatsExportData
): string => {
  const lines = data.threads
    .map((thread) => {
      const messages = thread.messages
        .filter(
          (message) =>
            (message.role === 'system' ||
              message.role === 'user' ||
              message.role === 'assistant') &&
            Boolean(message.content)
        )
        .map((message) => ({
          role: message.role,
          content: message.content,
        }))

      if (messages.length === 0) return ''

      return JSON.stringify({
        messages,
        metadata: {
          workspace_id: data.workspace.id,
          thread_id: thread.id,
          thread_title: thread.title,
        },
      })
    })
    .filter(Boolean)

  return lines.join('\n')
}
