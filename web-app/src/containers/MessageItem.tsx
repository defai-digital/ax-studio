import {
  memo,
  type ComponentProps,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import type { UIMessage, ChatStatus } from 'ai'
import { RenderMarkdown } from './RenderMarkdown'
import { cn } from '@/lib/utils'
import { SourcesFooter } from '@/components/citations/SourcesFooter'
import { useCitations } from '@/hooks/citations/use-citations'
import { useGuardrails } from '@/hooks/settings/useGuardrails'
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
import { CopyButton } from '@/components/common/CopyButton'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { EditMessageDialog } from '@/containers/dialogs/message/EditMessageDialog'
import { DeleteMessageDialog } from '@/containers/dialogs/message/DeleteMessageDialog'
import { TokenSpeedIndicator } from '@/containers/TokenSpeedIndicator'
import { extractFilesFromPrompt, FileMetadata } from '@/lib/fileMetadata'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  GitBranch,
  Paperclip,
  RefreshCw,
  Zap,
} from 'lucide-react'
import { useMessages } from '@/hooks/chat/useMessages'
import { useForkThread } from '@/hooks/threads/use-fork-thread'
import { MessageRatingActions } from '@/components/chat/MessageRatingActions'
import type { VersionInfo } from '@/lib/messages/versions'
import { RoutingBadge } from '@/components/RoutingBadge'
import type { CitationData } from '@/types/citation-types'
import { useTranslation } from '@/i18n/react-i18next-compat'

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

const CONTENT_TYPE = {
  TEXT: 'text',
  FILE: 'file',
  REASONING: 'reasoning',
} as const

type FilePart = {
  type: 'file'
  filename?: string
  url?: string
  mediaType?: string
}

type ToolPart = {
  type: 'dynamic-tool' | `tool-${string}`
  state: ComponentProps<typeof Tool>['state']
  toolName?: string
  input?: unknown
  output?: unknown
  error?: string
  errorText?: string
}

export type MessageItemProps = {
  message: UIMessage
  isLastMessage: boolean
  status: ChatStatus
  threadId?: string
  reasoningContainerRef?: React.RefObject<HTMLDivElement | null>
  onRegenerate?: (messageId: string) => void
  onEdit?: (messageId: string, newText: string) => void
  onDelete?: (messageId: string) => void
  versionInfo?: VersionInfo
  onSwitchVersion?: (groupId: string, direction: 'prev' | 'next') => void
  assistant?: { avatar?: React.ReactNode; name?: string }
}

type PreviewImage = { url: string; filename?: string }

/** Shared image lightbox — focus-trapped Radix Dialog for keyboard/Esc support. */
function ImagePreviewDialog({
  previewImage,
  onClose,
}: {
  previewImage: PreviewImage
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="max-w-[min(90vw,56rem)] border-none bg-transparent p-2 shadow-none sm:max-w-[min(90vw,56rem)]"
        showCloseButton
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {previewImage.filename || t('common:preview')}
        </DialogTitle>
        <img
          src={previewImage.url}
          alt={previewImage.filename || t('common:preview')}
          className="max-h-[85vh] max-w-full object-contain rounded-lg mx-auto"
        />
      </DialogContent>
    </Dialog>
  )
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
    versionInfo,
    onSwitchVersion,
  }: MessageItemProps) => {
    const { t } = useTranslation()
    const selectedModel = useModelProvider((state) => state.selectedModel)
    const updateMessage = useMessages((state) => state.updateMessage)
    const storedThreadMessage = useMessages((state) =>
      threadId
        ? state.messages[threadId]?.find((m) => m.id === message.id)
        : undefined
    )
    const [previewImage, setPreviewImage] = useState<{
      url: string
      filename?: string
    } | null>(null)

    const meta = message.metadata as Record<string, unknown> | undefined
    const currentRating = meta?.rating as 'up' | 'down' | undefined
    const currentFeedback = meta?.feedback as
      | { reasons?: string[]; comment?: string }
      | undefined
    const localKnowledgeRetrieval = meta?.localKnowledgeRetrieval as
      | {
          searched?: boolean
          extracted?: boolean
          source?: string
          error?: string
        }
      | undefined

    const hydrateCitations = useCitations((s) => s.hydrate)
    const metadataCitationData = meta?.citationData as CitationData | undefined
    useEffect(() => {
      if (message.role === 'assistant' && metadataCitationData) {
        hydrateCitations(message.id, { citationData: metadataCitationData })
      }
    }, [hydrateCitations, message.id, message.role, metadataCitationData])
    const citationData = useCitations((s) => s.getCitations(message.id))
    const flagLowConfidence = useGuardrails((s) => s.flagLowConfidence)

    const persistRating = useCallback(
      (
        rating: 'up' | 'down' | undefined,
        feedback?: { reasons: string[]; comment: string }
      ) => {
        if (!threadId || !storedThreadMessage) return
        const existingMeta = (message.metadata ?? {}) as Record<string, unknown>
        const nextMeta: Record<string, unknown> = { ...existingMeta, rating }
        if (rating === 'down' && feedback) {
          nextMeta.feedback = {
            reasons: feedback.reasons,
            comment: feedback.comment,
            at: Date.now(),
          }
        } else {
          delete nextMeta.feedback
        }
        updateMessage({ ...storedThreadMessage, metadata: nextMeta })
      },
      [message.metadata, storedThreadMessage, threadId, updateMessage]
    )

    const handleRateUp = useCallback(
      () => persistRating(currentRating === 'up' ? undefined : 'up'),
      [persistRating, currentRating]
    )
    const handleSubmitDownvote = useCallback(
      (data: { reasons: string[]; comment: string }) =>
        persistRating('down', data),
      [persistRating]
    )
    const handleClearRating = useCallback(
      () => persistRating(undefined),
      [persistRating]
    )

    const handleRegenerate = useCallback(() => {
      onRegenerate?.(message.id)
    }, [onRegenerate, message.id])

    const handleSwitchVersion = useCallback(
      (direction: 'prev' | 'next') => {
        if (!versionInfo) return
        onSwitchVersion?.(versionInfo.groupId, direction)
      },
      [onSwitchVersion, versionInfo]
    )

    const handleEdit = useCallback(
      (newText: string) => {
        onEdit?.(message.id, newText)
      },
      [onEdit, message.id]
    )

    const handleDelete = useCallback(() => {
      onDelete?.(message.id)
    }, [onDelete, message.id])

    const forkThread = useForkThread()
    const [isForking, setIsForking] = useState(false)
    const handleFork = useCallback(async () => {
      if (!threadId || isForking) return
      setIsForking(true)
      try {
        await forkThread(threadId, message.id)
      } finally {
        setIsForking(false)
      }
    }, [forkThread, threadId, message.id, isForking])

    // Get image URLs from file parts for the edit dialog
    const imageUrls = useMemo(() => {
      return message.parts
        .filter((part) => {
          if (part.type !== 'file') return false
          const filePart = part as {
            type: 'file'
            url?: string
            mediaType?: string
          }
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

      const thinkMatch =
        message.role === 'assistant'
          ? displayText.match(/<think[^>]*>([\s\S]*?)(?:<\/think>|$)([\s\S]*)/i)
          : null

      if (thinkMatch) {
        const reasoningText = thinkMatch[1]?.trim() ?? ''
        const finalText = (thinkMatch[2] ?? '').trim()

        return (
          <div
            key={`${message.id}-${partIndex}`}
            className="w-full min-w-0 overflow-hidden"
          >
            {reasoningText &&
              renderReasoningPart(
                { type: 'reasoning', text: reasoningText },
                partIndex
              )}
            {finalText && (
              <RenderMarkdown
                content={finalText}
                isStreaming={isStreaming && isLastPart}
                messageId={message.id}
                threadId={threadId}
              />
            )}
          </div>
        )
      }

      if (
        !displayText.trim() &&
        message.role === 'user' &&
        attachedFiles.length === 0
      ) {
        return null
      }

      return (
        <div
          key={`${message.id}-${partIndex}`}
          className="w-full min-w-0 overflow-hidden"
        >
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
                        <Paperclip
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
                    className="px-4 py-3 rounded-2xl rounded-tr-sm text-primary-foreground shadow-sm select-text whitespace-pre-wrap break-words overflow-hidden bg-brand-gradient"
                    style={{
                      fontSize: '14px',
                      lineHeight: '1.6',
                    }}
                  >
                    {displayText}
                  </div>
                )}
                {localKnowledgeRetrieval?.searched && (
                  <div className="mt-2 flex justify-end">
                    <div className="flex max-w-[80%] items-center gap-2 rounded-xl border border-border/60 bg-muted px-3 py-1.5 text-[11px] text-muted-foreground">
                      <Database size={13} />
                      <span>
                        Searched local knowledge
                        {localKnowledgeRetrieval.extracted
                          ? ' and extracted source'
                          : ''}
                      </span>
                      {localKnowledgeRetrieval.source && (
                        <span className="truncate max-w-64 font-mono">
                          {localKnowledgeRetrieval.source.split(/[\\/]/).pop()}
                        </span>
                      )}
                    </div>
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
      const isSafeUrl = part.url && /^https?:|^blob:|^data:/i.test(part.url)

      if (message.role === 'user' && isImage && isSafeUrl) {
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

      if (message.role === 'assistant' && isImage && isSafeUrl) {
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
              className={cn(
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

    const renderToolPart = (part: unknown, partIndex: number) => {
      // AI SDK v5 emits two shapes for tool parts:
      //   ToolUIPart      → type: 'tool-{name}'   (static/chat-level tools)
      //   DynamicToolUIPart → type: 'dynamic-tool', toolName: string  (streamText tools)
      // Both carry a `state` field; anything else is not a tool part.
      if (
        !part ||
        typeof part !== 'object' ||
        !('type' in part) ||
        !('state' in part)
      ) {
        return null
      }

      const maybeToolPart = part as Partial<ToolPart>
      const isDynamic = maybeToolPart.type === 'dynamic-tool'
      const isStatic =
        typeof maybeToolPart.type === 'string' &&
        maybeToolPart.type.startsWith('tool-')
      if ((!isDynamic && !isStatic) || !maybeToolPart.state) {
        return null
      }

      const toolPart = maybeToolPart as ToolPart
      const toolName: string = isDynamic
        ? (toolPart.toolName ?? 'dynamic-tool')
        : toolPart.type.split('-').slice(1).join('-')

      return (
        <Tool
          key={`${message.id}-${partIndex}`}
          state={toolPart.state}
          className="mb-3"
        >
          <ToolHeader
            title={toolName}
            type={`tool-${toolName}` as `tool-${string}`}
            state={toolPart.state}
          />
          <ToolContent title={toolName}>
            {Boolean(toolPart.input) && (
              <ToolInput
                input={
                  typeof toolPart.input === 'string'
                    ? toolPart.input
                    : JSON.stringify(toolPart.input)
                }
              />
            )}
            {Boolean(toolPart.output) && (
              <ToolOutput
                output={toolPart.output}
                resolver={(input) => Promise.resolve(input)}
                errorText={undefined}
              />
            )}
            {toolPart.state === 'output-error' && (
              <ToolOutput
                output={undefined}
                errorText={
                  toolPart.error ||
                  toolPart.errorText ||
                  'Tool execution failed'
                }
                resolver={(input) => Promise.resolve(input)}
              />
            )}
          </ToolContent>
        </Tool>
      )
    }

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
                return renderFilePart(part as FilePart, i)
              default:
                return null
            }
          })}

          {/* Message actions — visible on hover OR keyboard focus (not hover-only) */}
          <div className="flex items-center justify-end gap-0.5 mt-1 opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 transition-opacity">
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

          {/* Image preview — focus-trapped dialog for keyboard/Esc support */}
          {previewImage && (
            <ImagePreviewDialog
              previewImage={previewImage}
              onClose={() => setPreviewImage(null)}
            />
          )}
        </div>
      )
    }

    // Assistant message layout
    return (
      <div className="w-full mb-2 group/message">
        <div className="flex w-full gap-3">
          {/* Avatar */}
          <div className="size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-md bg-brand-gradient">
            <Zap className="size-4 text-primary-foreground" strokeWidth={2.5} />
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            {/* Routing badge — shown when the LLM Router selected this model */}
            {(() => {
              const meta = message.metadata as
                | Record<string, unknown>
                | undefined
              const routing = meta?.routing as
                | {
                    modelId?: string
                    providerId?: string
                    reason?: string
                    routed?: boolean
                  }
                | undefined
              if (routing?.routed && routing.modelId) {
                return (
                  <RoutingBadge
                    modelId={routing.modelId}
                    providerId={routing.providerId}
                    reason={routing.reason ?? ''}
                  />
                )
              }
              return null
            })()}
            {/* Render message parts */}
            {message.parts.map((part, i) => {
              switch (part.type) {
                case CONTENT_TYPE.TEXT:
                  return renderTextPart(
                    part as { type: 'text'; text: string },
                    i
                  )
                case CONTENT_TYPE.FILE:
                  return renderFilePart(part as FilePart, i)
                case CONTENT_TYPE.REASONING:
                  return renderReasoningPart(
                    part as { type: 'reasoning'; text: string },
                    i
                  )
                default:
                  return renderToolPart(part, i)
              }
            })}

            {/* Sources footer — shown when citation data exists */}
            {message.role === 'assistant' && citationData && (
              <SourcesFooter
                citationData={citationData}
                showConfidence={flagLowConfidence}
              />
            )}

            {/* Action bar — hover or focus-within so keyboard users can reach actions */}
            <div className="flex items-center justify-between mt-2 opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 transition-opacity">
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

                {selectedModel &&
                  onRegenerate &&
                  !isStreaming &&
                  isLastMessage && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleRegenerate}
                      title={t('common:regenerate')}
                      aria-label={t('common:regenerate')}
                      className="text-muted-foreground/50 hover:text-foreground"
                    >
                      <RefreshCw size={14} />
                    </Button>
                  )}

                {/* Response version switcher — flips between regenerated attempts */}
                {versionInfo && !isStreaming && isLastMessage && (
                  <div className="flex items-center gap-0.5 text-muted-foreground/50 px-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleSwitchVersion('prev')}
                      disabled={versionInfo.position <= 1}
                      title={t('common:previousVersion')}
                      aria-label={t('common:previousVersion')}
                      className="hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <span className="text-xs tabular-nums select-none">
                      {versionInfo.position}/{versionInfo.total}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleSwitchVersion('next')}
                      disabled={versionInfo.position >= versionInfo.total}
                      title={t('common:nextVersion')}
                      aria-label={t('common:nextVersion')}
                      className="hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                )}

                {/* Fork conversation — branch into a new thread from this point */}
                {threadId && !isStreaming && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleFork}
                    disabled={isForking}
                    title={t('common:branchConversation')}
                    aria-label={t('common:branchConversation')}
                    className="text-muted-foreground/50 hover:text-primary disabled:opacity-30"
                  >
                    <GitBranch className="size-3.5" />
                  </Button>
                )}

                {/* Thumbs up / down rating with downvote feedback capture */}
                <MessageRatingActions
                  rating={currentRating}
                  feedback={currentFeedback}
                  onRateUp={handleRateUp}
                  onSubmitDownvote={handleSubmitDownvote}
                  onClearRating={handleClearRating}
                />
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
          <ImagePreviewDialog
            previewImage={previewImage}
            onClose={() => setPreviewImage(null)}
          />
        )}
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Always re-render if streaming and this is the last message
    if (nextProps.isLastMessage && nextProps.status === CHAT_STATUS.STREAMING) {
      return false
    }

    // versionInfo is recomputed fresh on every MessagesArea render, so compare
    // its contents rather than object identity (which would always differ).
    const versionInfoEqual =
      prevProps.versionInfo?.position === nextProps.versionInfo?.position &&
      prevProps.versionInfo?.total === nextProps.versionInfo?.total &&
      prevProps.versionInfo?.groupId === nextProps.versionInfo?.groupId

    return (
      prevProps.message === nextProps.message &&
      prevProps.isLastMessage === nextProps.isLastMessage &&
      prevProps.status === nextProps.status &&
      versionInfoEqual
    )
  }
)

MessageItem.displayName = 'MessageItem'
