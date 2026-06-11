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

export function isValidContentItem(item: unknown): item is ChatCompletionMessageContentItem {
  if (!item || typeof item !== 'object') return false

  const obj = item as Record<string, unknown>
  switch (obj.type) {
    case ChatCompletionMessageContentType.Text:
      return typeof obj.text === 'string'
    case ChatCompletionMessageContentType.Image:
      return !!obj.image_url &&
             typeof obj.image_url === 'object' &&
             typeof (obj.image_url as Record<string, unknown>).url === 'string'
    case ChatCompletionMessageContentType.Doc:
      return !!obj.doc_url &&
             typeof obj.doc_url === 'object' &&
             typeof (obj.doc_url as Record<string, unknown>).url === 'string'
    default:
      return false
  }
}

export function validateMessageContent(content: ChatCompletionMessageContent): boolean {
  if (typeof content === 'string') {
    return true
  }

  if (Array.isArray(content)) {
    return content.length > 0 && content.every(isValidContentItem)
  }

  return false
}
