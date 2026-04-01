import { ContentType, ContentValue } from '../message'

/**
 * The role of the author of this message.
 */
export enum ChatCompletionRole {
  System = 'system',
  Assistant = 'assistant',
  User = 'user',
  Tool = 'tool',
}

/**
 * The `MessageRequest` type defines the shape of a new message request object.
 * @data_transfer_object
 */
export type ChatCompletionMessage = {
  /** The contents of the message. **/
  content?: ChatCompletionMessageContent
  /** The role of the author of this message. **/
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

/**
 * Discriminated union for message content items
 * Ensures type safety by requiring correct properties for each type
 */
export type ChatCompletionMessageContentItem =
  | { type: typeof ChatCompletionMessageContentType.Text; text: string }
  | { type: typeof ChatCompletionMessageContentType.Image; image_url: { url: string } }
  | { type: typeof ChatCompletionMessageContentType.Doc; doc_url: { url: string } }

export type ChatCompletionMessageContent =
  | string
  | ChatCompletionMessageContentItem[]

/**
 * Type guard to check if an object is a valid ChatCompletionMessageContentItem
 */
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

/**
 * Validates ChatCompletionMessageContent at runtime
 */
export function validateMessageContent(content: ChatCompletionMessageContent): boolean {
  if (typeof content === 'string') {
    return true
  }

  if (Array.isArray(content)) {
    return content.every(isValidContentItem)
  }

  return false
}
