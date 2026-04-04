// Hooks
export { useChat } from './hooks/useChat'
export { useChatSendHandler } from './hooks/useChatSendHandler'
export { useChatAttachments, NEW_THREAD_ATTACHMENT_KEY } from './hooks/useChatAttachments'
export { useMessages } from './hooks/useMessages'
export { useAttachments } from './hooks/useAttachments'
export { useAttachmentIngestionPrompt } from './hooks/useAttachmentIngestionPrompt'
export { useDocumentAttachmentHandler } from './hooks/useDocumentAttachmentHandler'
export { useImageAttachmentHandler } from './hooks/useImageAttachmentHandler'
export { usePrompt } from './hooks/usePrompt'
export { useCodeExecution } from './hooks/useCodeExecution'

// Lib
export { createChatTransport } from './lib/chat-transport-factory'
export {
  createChatSession,
  stopChatSession,
  isSessionBusy,
} from './lib/chat-session-controller'
export type { SessionData, ChatSession } from './lib/chat-session-types'
export { isLocalProvider, assertProviderReadyForChat } from './lib/model-session'

// Transport
export { executeSingleAgentStream } from './transport/single-agent-transport'
export type { SingleAgentConfig } from './transport/single-agent-transport'
export { executeMultiAgentStream } from './transport/multi-agent-transport'
export type { MultiAgentConfig } from './transport/multi-agent-transport'
export { stripUnavailableToolParts } from './transport/transport-types'
export type {
  ChatTransport,
  TokenUsageCallback,
  OnFinishCallback,
  OnToolCallCallback,
  ServiceHub,
  SendMessagesOptions,
  SendMessagesResult,
} from './transport/transport-types'

// Stores
export { useChatSessions } from './stores/chat-session-store'

// Components
export { default as ChatInput } from './components/ChatInput'
export { ChatInputToolbar } from './components/ChatInputToolbar'
export { ChatInputAttachments } from './components/ChatInputAttachments'
