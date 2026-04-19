import { ContentType, ContentValue } from '../message'

export enum ChatCompletionRole {
  System = 'system',
  Assistant = 'assistant',
  User = 'user',
  Tool = 'tool',
}

export type ChatCompletionMessage = {
  content?: ChatCompletionMessageContent
  role: ChatCompletionRole
  type?: string
  output?: string
  tool_call_id?: string
}

export enum ChatCompletionMessageContentType {
  Text = 'text',
  Image = 'image_url',
  Doc = 'doc_url',
}

export type ChatCompletionMessageContentItem =
  | { type: typeof ChatCompletionMessageContentType.Text; text: string }
  | { type: typeof ChatCompletionMessageContentType.Image; image_url: { url: string } }
  | { type: typeof ChatCompletionMessageContentType.Doc; doc_url: { url: string } }

export type ChatCompletionMessageContent =
  | string
  | ChatCompletionMessageContentItem[]

export function isValidContentItem(item: any): item is ChatCompletionMessageContentItem {
  if (!item || typeof item !== 'object') return false

  switch (item.type) {
    case ChatCompletionMessageContentType.Text:
      return typeof item.text === 'string'
    case ChatCompletionMessageContentType.Image:
      return item.image_url &&
             typeof item.image_url === 'object' &&
             typeof item.image_url.url === 'string'
    case ChatCompletionMessageContentType.Doc:
      return item.doc_url &&
             typeof item.doc_url === 'object' &&
             typeof item.doc_url.url === 'string'
    default:
      return false
  }
}

export function validateMessageContent(content: ChatCompletionMessageContent): boolean {
  if (typeof content === 'string') {
    return true
  }

  if (Array.isArray(content)) {
    return content.every(isValidContentItem)
  }

  return false
}
