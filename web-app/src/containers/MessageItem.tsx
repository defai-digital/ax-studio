/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useState, useCallback } from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { twMerge } from 'tailwind-merge'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import { CopyButton } from './CopyButton'
import { useModelProvider } from '@/features/models/hooks/useModelProvider'
import { IconRefresh, IconPaperclip } from '@tabler/icons-react'
import { EditMessageDialog } from '@/containers/dialogs/EditMessageDialog'
import { DeleteMessageDialog } from '@/containers/dialogs/DeleteMessageDialog'
import TokenSpeedIndicator from '@/containers/TokenSpeedIndicator'
import { extractFilesFromPrompt, FileMetadata } from '@/lib/fileMetadata'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { AgentOutputCard } from '@/features/multi-agent/components/AgentOutputCard'
import { RunLogSummary } from '@/features/multi-agent/components/RunLogViewer'
import type { AgentStatusData } from '@/types/agent-data-parts'
import type { RunLogData } from '@/features/multi-agent/lib/run-log'
import { Zap, GitBranch, ThumbsUp, ThumbsDown } from 'lucide-react'
import { RoutingBadge } from '@/features/multi-agent/components/RoutingBadge'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

export type MessageItemProps = {
  message: UIMessage
  isFirstMessage: boolean
  isLastMessage: boolean
  status: ChatStatus
  threadId?: string
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  onRegenerate?: (messageId: string) => void
  onEdit?: (messageId: string, newText: string) => void
  onDelete?: (messageId: string) => void
  assistant?: { avatar?: React.ReactNode; name?: string }
  showAssistant?: boolean
}

export const MessageItem = memo(
  ({
    message,
    isLastMessage,
    status,
    threadId,
    reasoningContainerRef,
    onRegenerate,
    onEdit,
    onDelete,
  }: MessageItemProps) => {
    const selectedModel = useModelProvider((state) => state.selectedModel)
    const [previewImage, setPreviewImage] = useState<{
      url: string
      filename?: string
    } | null>(null)


    const handleRegenerate = useCallback(() => {
      onRegenerate?.(message.id)
    }, [onRegenerate, message.id])

    const handleEdit = useCallback(
      (newText: string) => {
        onEdit?.(message.id, newText)
      },
      [onEdit, message.id]
    )

    const handleDelete = useCallback(() => {
      onDelete?.(message.id)
    }, [onDelete, message.id])

    // Get image URLs from file parts for the edit dialog
    const imageUrls = useMemo(() => {
      return message.parts
        .filter((part) => {
          if (part.type !== 'file') return false
          const filePart = part as { type: 'file'; url?: string; mediaType?: string }
          return filePart.url && filePart.mediaType?.startsWith('image/')
        })
        .map((part) => (part as { url: string }).url)
    }, [message.parts])

    const isStreaming = isLastMessage && status === CHAT_STATUS.STREAMING

    // Extract file metadata from message text (for user messages with attachments)
    const attachedFiles = useMemo(() => {
      if (message.role !== 'user') return []

      const textParts = message.parts.filter(
        (part): part is { type: 'text'; text: string } =>
          part.type === CONTENT_TYPE.TEXT
      )

      if (textParts.length === 0) return []

      const { files } = extractFilesFromPrompt(textParts[0].text)
      return files
    }, [message.parts, message.role])

    // Get full text content for copy button
    const getFullTextContent = useCallback(() => {
      return message.parts
        .filter(
          (part): part is { type: 'text'; text: string } =>
            part.type === CONTENT_TYPE.TEXT
        )
        .map((part) => part.text)
        .join('\n')
    }, [message.parts])

    const renderTextPart = (
      part: { type: 'text'; text: string },
      partIndex: number
    ) => {
      if (!part.text || part.text.trim() === '') {
        return null
      }

      const isLastPart = partIndex === message.parts.length - 1

      // For user messages, extract and clean the text from file metadata
      const displayText =
        message.role === 'user'
          ? extractFilesFromPrompt(part.text).cleanPrompt
          : part.text

      if (
        !displayText.trim() &&
        message.role === 'user' &&
        attachedFiles.length === 0
      ) {
        return null
      }

      return (
        <div key={`${message.id}-${partIndex}`} className="w-full min-w-0 overflow-hidden">
          {message.role === 'user' ? (
            <div className="flex justify-end w-full h-full text-start break-words whitespace-normal">
              <div className="relative max-w-[80%]">
                {/* Show attached files if any */}
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2 justify-end">
                    {attachedFiles.map((file: FileMetadata, idx: number) => (
                      <div
                        key={`file-${idx}-${file.id}`}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted border border-border/50 text-[12px]"
                      >
                        <IconPaperclip
                          size={14}
                          className="text-muted-foreground"
                        />
                        <span className="font-medium">{file.name}</span>
                        {file.injectionMode && (
                          <span className="text-muted-foreground text-[11px]">
                            {file.injectionMode}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {displayText && (
                  <div
                    className="px-4 py-3 rounded-2xl rounded-tr-sm text-white shadow-sm select-text whitespace-pre-wrap break-words overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #7c3aed)', fontSize: '14px', lineHeight: '1.6' }}
                  >
                    {displayText}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <RenderMarkdown
                content={part.text}
                isStreaming={isStreaming && isLastPart}
                messageId={message.id}
                threadId={threadId}
              />
            </>
          )}
        </div>
      )
    }

    const renderFilePart = (
      part: {
        type: 'file'
        filename?: string
        url?: string
        mediaType?: string
      },
      partIndex: number
    ) => {
      const isImage = part.mediaType?.startsWith('image/')

      if (message.role === 'user' && isImage && part.url) {
        return (
          <div
            key={`${message.id}-${partIndex}`}
            className="flex justify-end w-full my-2"
          >
            <div className="flex flex-wrap gap-2 max-w-[80%] justify-end">
              <div className="relative">
                <img
                  src={part.url}
                  alt={part.filename || 'Uploaded attachment'}
                  className="size-20 rounded-xl object-cover border border-border/50 cursor-pointer shadow-sm hover:shadow-md transition-shadow"
                  onClick={() =>
                    setPreviewImage({ url: part.url!, filename: part.filename })
                  }
                />
              </div>
            </div>
          </div>
        )
      }

      if (message.role === 'assistant' && isImage && part.url) {
        return (
          <div key={`${message.id}-${partIndex}`} className="my-2">
            <img
              src={part.url}
              alt={part.filename || 'Generated image'}
              className="max-w-full rounded-xl cursor-pointer shadow-sm hover:shadow-md transition-shadow"
              onClick={() =>
                setPreviewImage({ url: part.url!, filename: part.filename })
              }
            />
          </div>
        )
      }

      return null
    }

    const renderReasoningPart = (
      part: { type: 'reasoning'; text: string },
      partIndex: number
    ) => {
      const isLastPart = partIndex === message.parts.length - 1
      const shouldBeOpen = isStreaming && isLastPart

      return (
        <Reasoning
          key={`${message.id}-${partIndex}`}
          className="w-full text-muted-foreground mb-3"
          isStreaming={isStreaming && isLastPart}
          defaultOpen={shouldBeOpen}
        >
          <ReasoningTrigger />
          <div className="relative">
            {isStreaming && (
              <div className="absolute top-0 left-0 right-0 h-8 bg-linear-to-br from-neutral-50 mask-t-from-98% dark:from-background to-transparent pointer-events-none z-10" />
            )}
            <div
              ref={isStreaming ? reasoningContainerRef : null}
              className={twMerge(
                'w-full overflow-auto relative',
                isStreaming
                  ? 'max-h-32 opacity-70 mt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                  : 'h-auto opacity-100'
              )}
            >
              <ReasoningContent>{part.text}</ReasoningContent>
            </div>
          </div>
        </Reasoning>
      )
    }

    const renderToolPart = (part: any, partIndex: number) => {
      // AI SDK v5 emits two shapes for tool parts:
      //   ToolUIPart      → type: 'tool-{name}'   (static/chat-level tools)
      //   DynamicToolUIPart → type: 'dynamic-tool', toolName: string  (streamText tools)
      // Both carry a `state` field; anything else is not a tool part.
      const isDynamic = part.type === 'dynamic-tool'
      const isStatic = typeof part.type === 'string' && part.type.startsWith('tool-')
      if ((!isDynamic && !isStatic) || !('state' in part)) {
        return null
      }

      const toolName: string = isDynamic
        ? (part.toolName as string)
        : part.type.split('-').slice(1).join('-')

      // generate_diagram: render the diagram inline via the Mermaid pipeline
      // instead of showing a JSON tool card
      if (toolName === 'generate_diagram') {
        // Strip fence markers if the model returned them inside the source field
        // (double-fencing causes a parse error: ```mermaid\n```mermaid\n...\n```)
        const rawSource: string = part.output?.source ?? ''
        const source = rawSource
          .replace(/^```mermaid\s*/i, '')
          .replace(/```\s*$/, '')
          .trim()
        const title: string = part.output?.title ?? ''
        if (source) {
          return (
            <div key={`${message.id}-${partIndex}`} className="mb-2">
              {title && (
                <p className="text-xs text-muted-foreground mb-1 font-medium">
                  {title}
                </p>
              )}
              <RenderMarkdown
                content={`\`\`\`mermaid\n${source}\n\`\`\``}
                messageId={message.id}
              />
            </div>
          )
        }
        // Tool call in progress — source not yet available, render nothing.
        // The diagram will appear as soon as the tool output resolves.
        return null
      }

      return (
        <Tool
          key={`${message.id}-${partIndex}`}
          state={part.state}
          className="mb-3"
        >
          <ToolHeader
            title={toolName}
            type={`tool-${toolName}` as `tool-${string}`}
            state={part.state}
          />
          <ToolContent title={toolName}>
            {part.input && (
              <ToolInput
                input={
                  typeof part.input === 'string'
                    ? part.input
                    : JSON.stringify(part.input)
                }
              />
            )}
            {part.output && (
              <ToolOutput
                output={part.output}
                resolver={(input) => Promise.resolve(input)}
                errorText={undefined}
              />
            )}
            {part.state === 'output-error' && (
              <ToolOutput
                output={undefined}
                errorText={part.error || part.errorText || 'Tool execution failed'}
                resolver={(input) => Promise.resolve(input)}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

    // Deduplicate agent status parts: only render the latest status per agent_id.
    // Each agent emits 'running' then 'complete'/'error' — showing both would be confusing.
    const latestAgentStatusIndex = useMemo(() => {
      const lastIndex = new Map<string, number>()
      message.parts.forEach((part, i) => {
        if (part.type === 'data-agentStatus') {
          const data = (part as any).data as AgentStatusData
          lastIndex.set(data.agent_id, i)
        }
      })
      return lastIndex
    }, [message.parts])

    // User message layout
    if (message.role === 'user') {
      return (
        <div className="w-full mb-2 group/message">
          {/* Render message parts */}
          {message.parts.map((part, i) => {
            switch (part.type) {
              case CONTENT_TYPE.TEXT:
                return renderTextPart(part as { type: 'text'; text: string }, i)
              case CONTENT_TYPE.FILE:
                return renderFilePart(part as any, i)
              default:
                return null
            }
          })}

          {/* Message actions for user messages */}
          <div className="flex items-center justify-end gap-0.5 mt-1 opacity-0 group-hover/message:opacity-100 transition-opacity">
            <CopyButton text={getFullTextContent()} />

            {onEdit && status !== CHAT_STATUS.STREAMING && (
              <EditMessageDialog
                message={getFullTextContent()}
                imageUrls={imageUrls.length > 0 ? imageUrls : undefined}
                onSave={handleEdit}
              />
            )}

            {onDelete && status !== CHAT_STATUS.STREAMING && (
              <DeleteMessageDialog onDelete={handleDelete} />
            )}
          </div>

          {/* Image Preview Dialog */}
          {previewImage && (
            <div
              className="fixed inset-0 z-100 bg-black/70 backdrop-blur-md flex items-center justify-center cursor-pointer"
              onClick={() => setPreviewImage(null)}
            >
              <img
                src={previewImage.url}
                alt={previewImage.filename || 'Preview'}
                className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
        </div>
      )
    }

    // Assistant message layout
    return (
      <div className="w-full mb-2 group/message">
        <div className="flex w-full gap-3">
          {/* Avatar */}
          <div
            className="size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-md"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          >
            <Zap className="size-4 text-white" strokeWidth={2.5} />
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            {/* Routing badge — shown when the LLM Router selected this model */}
            {(() => {
              const meta = message.metadata as Record<string, unknown> | undefined
              const routing = meta?.routing as { modelId?: string; reason?: string; routed?: boolean } | undefined
              if (routing?.routed && routing.modelId) {
                return <RoutingBadge modelId={routing.modelId} reason={routing.reason ?? ''} />
              }
              return null
            })()}
            {/* Render message parts */}
            {message.parts.map((part, i) => {
              switch (part.type) {
                case CONTENT_TYPE.TEXT:
                  return renderTextPart(part as { type: 'text'; text: string }, i)
                case CONTENT_TYPE.FILE:
                  return renderFilePart(part as any, i)
                case CONTENT_TYPE.REASONING:
                  return renderReasoningPart(
                    part as { type: 'reasoning'; text: string },
                    i
                  )
                case 'data-agentStatus': {
                  const data = (part as any).data as AgentStatusData
                  // Skip superseded status parts (e.g., 'running' followed by 'complete')
                  if (latestAgentStatusIndex.get(data.agent_id) !== i) return null
                  return (
                    <AgentOutputCard
                      key={`agent-${data.agent_id}-${i}`}
                      agentName={data.agent_name}
                      agentRole={data.agent_role}
                      status={data.status}
                      tokensUsed={data.tokens_used}
                      toolCalls={data.tool_calls}
                      error={data.error}
                      isCollapsed={data.status === 'complete' && !isLastMessage}
                    />
                  )
                }
                case 'data-runLog': {
                  const data = (part as any).data as RunLogData
                  return <RunLogSummary key={`runlog-${data.id}`} runLog={data} />
                }
                default:
                  return renderToolPart(part, i)
              }
            })}

            {/* Action Bar */}
            <div className="flex items-center justify-between mt-2 opacity-0 group-hover/message:opacity-100 transition-opacity">
              <div
                className={cn(
                  'flex items-center gap-0.5',
                  isStreaming && 'hidden'
                )}
              >
                <CopyButton text={getFullTextContent()} />

                {onDelete && !isStreaming && (
                  <DeleteMessageDialog onDelete={handleDelete} />
                )}

                {selectedModel && onRegenerate && !isStreaming && isLastMessage && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleRegenerate}
                    title="Regenerate response"
                    aria-label="Regenerate response"
                    className="text-muted-foreground/50 hover:text-foreground"
                  >
                    <IconRefresh size={14} />
                  </Button>
                )}

                {/* Fork conversation — disabled until fork logic is implemented */}
                {/* TODO: Wire to fork/branch logic when available */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled
                  title="Fork conversation"
                  aria-label="Fork conversation"
                  className="text-muted-foreground/50 hover:text-violet-500 disabled:opacity-30"
                >
                  <GitBranch className="size-3.5" />
                </Button>

                {/* Thumbs up / down rating */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Good response"
                  aria-label="Good response"
                  className="text-muted-foreground/50 hover:text-emerald-500"
                  onClick={() => {
                    // TODO: Store rating in message metadata when rating infrastructure exists
                  }}
                >
                  <ThumbsUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="Poor response"
                  aria-label="Poor response"
                  className="text-muted-foreground/50 hover:text-rose-500"
                  onClick={() => {
                    // TODO: Store rating in message metadata when rating infrastructure exists
                  }}
                >
                  <ThumbsDown className="size-3.5" />
                </Button>
              </div>

              <TokenSpeedIndicator
                streaming={isStreaming}
                metadata={
                  message.metadata as Record<string, unknown> | undefined
                }
              />
            </div>
          </div>
        </div>

        {/* Image Preview Dialog */}
        {previewImage && (
          <div
            className="fixed inset-0 z-100 bg-black/70 backdrop-blur-md flex items-center justify-center cursor-pointer"
            onClick={() => setPreviewImage(null)}
          >
            <img
              src={previewImage.url}
              alt={previewImage.filename || 'Preview'}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Always re-render if streaming and this is the last message
    if (nextProps.isLastMessage && nextProps.status === CHAT_STATUS.STREAMING) {
      return false
    }

    return (
      prevProps.message === nextProps.message &&
      prevProps.isFirstMessage === nextProps.isFirstMessage &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.status === nextProps.status &&
      prevProps.showAssistant === nextProps.showAssistant
    )
  }
)

MessageItem.displayName = 'MessageItem'
