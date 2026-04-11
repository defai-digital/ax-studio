import { CompletionResponseChunk } from 'token.js'
import {
  chatCompletionChunk,
  ChatCompletionMessage,
  chatCompletionRequestMessage,
} from '@ax-studio/core'

// Helper function to get reasoning content from an object
function getReasoning(
  obj:
    | { reasoning_content?: string | null; reasoning?: string | null }
    | null
    | undefined
): string | null {
  return obj?.reasoning_content ?? obj?.reasoning ?? null
}

/**
 * Normalize the content of a message by removing reasoning content.
 * This is useful to ensure that reasoning content does not get sent to the model.
 * @param content
 * @returns
 */
export function removeReasoningContent(content: string): string {
  // Reasoning content should not be sent to the model.
  // Strip every think block, case-insensitive, so <Think>, <THINK>,
  // and mixed-case variants are all removed — and `/g` so a message
  // containing multiple think blocks doesn't leak the later ones.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '')

  if (content.includes('<|channel|>analysis<|message|>')) {
    const match = content.match(
      /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
    )
    if (match?.index !== undefined) {
      const splitIndex = match.index + match[0].length
      content = content.slice(splitIndex).trim()
    }
  }
  return content.trim()
}

// Extract reasoning from a message (for completed responses)
export function extractReasoningFromMessage(
  message: chatCompletionRequestMessage | ChatCompletionMessage
): string | null {
  if (!message) return null

  const extendedMessage = message as chatCompletionRequestMessage
  return getReasoning(extendedMessage)
}

// Extract reasoning from a chunk (for streaming responses)
function extractReasoningFromChunk(
  chunk: CompletionResponseChunk | chatCompletionChunk
): string | null {
  if (!chunk.choices?.[0]?.delta) return null

  const delta = chunk.choices[0].delta as chatCompletionRequestMessage
  const reasoning = getReasoning(delta)

  // Return null for falsy values, non-strings, or whitespace-only strings
  if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim())
    return null

  return reasoning
}

// Tracks reasoning state and appends reasoning tokens with proper think tags
export class ReasoningProcessor {
  private isReasoningActive = false

  processReasoningChunk(
    chunk: CompletionResponseChunk | chatCompletionChunk
  ): string {
    const reasoning = extractReasoningFromChunk(chunk)
    const chunkContent = chunk.choices?.[0]?.delta?.content || ''

    // Handle reasoning tokens
    if (reasoning) {
      if (!this.isReasoningActive) {
        this.isReasoningActive = true
        return '<think>' + reasoning
      }
      return reasoning
    }

    // Handle reasoning end when content starts
    if (this.isReasoningActive && chunkContent) {
      this.isReasoningActive = false
      return '</think>'
    }

    // No reasoning to process
    return ''
  }

  finalize(): string {
    if (this.isReasoningActive) {
      this.isReasoningActive = false
      return '</think>'
    }
    return ''
  }

  isReasoningInProgress(): boolean {
    return this.isReasoningActive
  }
}
