/**
 * chat-session-types — shared types for the chat session layer.
 * Imported by the session store, session controller, and transport factory.
 * Must not import React or Zustand.
 */
import type { Chat, UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import type { CustomChatTransport } from '@/lib/custom-chat-transport'

export type SessionData = {
  tools: unknown[]
  messages: UIMessage[]
  idMap: Map<string, string>
}

export type ChatSession = {
  chat: Chat<UIMessage>
  transport: CustomChatTransport
  status: ChatStatus
  title?: string
  isStreaming: boolean
  unsubscribers: Array<() => void>
  data: SessionData
}
