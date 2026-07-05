/**
 * ChatInputToolbar — the bottom action bar of ChatInput.
 *
 * Renders: attachment dropdown, capability toggles (tools, reasoning),
 * token counter, and the send/stop button. Pure UI — no data fetching.
 */
import { memo, type ComponentType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ArrowUp,
  Atom,
  Binary,
  Database,
  ImagePlus,
  Loader2,
  Paperclip,
  PlusIcon,
  Square,
  type LucideIcon,
  User,
  Wrench,
} from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { TokenCounter } from '@/components/TokenCounter'
import { AvatarEmoji } from '@/components/common/AvatarEmoji'
import { DropdownToolsAvailable } from '@/containers/DropdownToolsAvailable'
import { McpExtensionToolLoader } from '@/containers/McpExtensionToolLoader'
import type { MCPToolComponentProps, ThreadMessage } from '@ax-studio/core'
import type { MCPTool } from '@/types/mcp'

type ToolbarIndicatorProps = {
  icon: LucideIcon
  tooltip: ReactNode
  iconClassName?: string
}

// A read-only capability indicator. Looks like a chip, not a button, so it
// doesn't misrepresent a passive "this model supports X" signal as an action.
function ToolbarIndicator({
  icon: Icon,
  tooltip,
  iconClassName,
}: ToolbarIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-6 items-center justify-center rounded-md cursor-default">
          <Icon size={16} className={iconClassName} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

type Props = {
  // Layout state
  isStreaming: boolean
  prompt: string
  // Model selector — rendered at the far left of the toolbar (in the composer,
  // where competitors put it) rather than in the page header.
  modelSelector?: ReactNode
  // Model capabilities
  selectedModel: Model | undefined
  // Assistant selector
  projectId?: string
  initialMessage?: boolean
  selectedAssistant: Assistant | undefined
  setSelectedAssistant: (a: Assistant | undefined) => void
  currentThread: Thread | undefined | null
  updateCurrentThreadAssistant: (a: Assistant | undefined) => void
  effectiveThreadId?: string
  assistants: Assistant[]
  // MCP tools
  tools: MCPTool[]
  hasActiveMCPServers: boolean
  MCPToolComponent?: ComponentType<MCPToolComponentProps> | null
  dropdownToolsAvailable: boolean
  setDropdownToolsAvailable: (v: boolean) => void
  tooltipToolsAvailable: boolean
  setTooltipToolsAvailable: (v: boolean) => void
  // Local knowledge
  isLocalKnowledgeEnabled: boolean
  toggleLocalKnowledge: () => void
  // Token counter
  tokenCounterCompact: boolean
  threadMessages: ThreadMessage[]
  // Actions
  stopStreaming: (threadId: string) => void
  handleSendMessage: (prompt: string) => Promise<void>
  submitCurrentPrompt?: () => void
  onAttachDocuments?: () => void
  onAttachImages?: () => void
  ingestingDocs?: boolean
}

export const ChatInputToolbar = memo(function ChatInputToolbar({
  isStreaming,
  prompt,
  modelSelector,
  selectedModel,
  projectId,
  initialMessage,
  selectedAssistant,
  setSelectedAssistant,
  currentThread,
  updateCurrentThreadAssistant,
  effectiveThreadId,
  assistants,
  tools,
  hasActiveMCPServers,
  MCPToolComponent,
  dropdownToolsAvailable,
  setDropdownToolsAvailable,
  tooltipToolsAvailable,
  setTooltipToolsAvailable,
  isLocalKnowledgeEnabled,
  toggleLocalKnowledge,
  tokenCounterCompact,
  threadMessages,
  stopStreaming,
  handleSendMessage,
  submitCurrentPrompt,
  onAttachDocuments,
  onAttachImages,
  ingestingDocs,
}: Props) {
  const { t } = useTranslation()
  const selectedModelHasTools =
    selectedModel?.capabilities?.includes('tools') ?? false

  return (
    <div className="absolute z-20 bg-transparent bottom-0 w-full px-2 pb-2 pt-1">
      <div className="flex justify-between items-center w-full">
        {/* Left: model selector + action buttons */}
        <div className="px-1 flex items-center gap-1 flex-1 min-w-0">
          {modelSelector && <div className="shrink-0">{modelSelector}</div>}
          <div
            className={cn(
              'px-1 flex items-center flex-1 min-w-0 gap-1',
              isStreaming && 'opacity-50 pointer-events-none'
            )}
          >
            {/* Attachment + quick-prompt dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="rounded-full mr-2 mb-1"
                >
                  <PlusIcon size={18} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {onAttachDocuments && (
                  <DropdownMenuItem
                    onClick={onAttachDocuments}
                    disabled={ingestingDocs}
                  >
                    {ingestingDocs ? (
                      <Loader2
                        size={18}
                        className="text-muted-foreground animate-spin"
                      />
                    ) : (
                      <Paperclip size={18} className="text-muted-foreground" />
                    )}
                    <span>
                      {ingestingDocs
                        ? 'Indexing documents...'
                        : 'Attach Document'}
                    </span>
                  </DropdownMenuItem>
                )}
                {onAttachImages && (
                  <DropdownMenuItem onClick={onAttachImages}>
                    <ImagePlus size={18} className="text-muted-foreground" />
                    <span>Attach Image</span>
                  </DropdownMenuItem>
                )}
                {!projectId && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <User size={18} className="text-muted-foreground" />
                      <span>Use Assistant</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        className={
                          !selectedAssistant &&
                          !currentThread?.assistants?.length
                            ? 'bg-accent'
                            : ''
                        }
                        onClick={() => {
                          setSelectedAssistant(undefined)
                          if (effectiveThreadId)
                            updateCurrentThreadAssistant(undefined)
                        }}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="text-muted-foreground">—</span>
                          <span>None</span>
                          {!selectedAssistant &&
                            !currentThread?.assistants?.length && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                        </div>
                      </DropdownMenuItem>
                      {assistants.length > 0 ? (
                        assistants.map((assistant) => {
                          const isSelected =
                            (initialMessage &&
                              selectedAssistant?.id === assistant.id) ||
                            (assistant &&
                              currentThread?.assistants?.some(
                                (a) => a.id === assistant.id
                              ))
                          return (
                            <DropdownMenuItem
                              key={assistant.id}
                              className={isSelected ? 'bg-accent' : ''}
                              onClick={() => {
                                setSelectedAssistant(assistant)
                                if (effectiveThreadId)
                                  updateCurrentThreadAssistant(assistant)
                              }}
                            >
                              <div className="flex items-center gap-2 w-full">
                                <AvatarEmoji
                                  avatar={assistant.avatar}
                                  imageClassName="w-4 h-4 object-contain"
                                  textClassName="text-sm"
                                />
                                <span>
                                  {assistant.name || 'Unnamed Assistant'}
                                </span>
                                {isSelected && (
                                  <span className="ml-auto text-xs text-muted-foreground">
                                    ✓
                                  </span>
                                )}
                              </div>
                            </DropdownMenuItem>
                          )
                        })
                      ) : (
                        <DropdownMenuItem disabled>
                          <span className="text-muted-foreground">
                            No assistants available
                          </span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedModel?.capabilities?.includes('embeddings') && (
              <ToolbarIndicator
                icon={Binary}
                iconClassName="text-muted-foreground/70"
                tooltip={<p>{t('embeddings')}</p>}
              />
            )}

            {hasActiveMCPServers &&
              (selectedModelHasTools && MCPToolComponent ? (
                <McpExtensionToolLoader
                  tools={tools}
                  hasActiveMCPServers={hasActiveMCPServers}
                  selectedModelHasTools={selectedModelHasTools}
                  initialMessage={initialMessage}
                  threadId={effectiveThreadId}
                  MCPToolComponent={MCPToolComponent}
                />
              ) : (
                <Tooltip
                  open={tooltipToolsAvailable}
                  onOpenChange={setTooltipToolsAvailable}
                >
                  <TooltipTrigger asChild disabled={dropdownToolsAvailable}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        setDropdownToolsAvailable(false)
                        e.stopPropagation()
                      }}
                    >
                      <DropdownToolsAvailable
                        initialMessage={initialMessage}
                        threadId={effectiveThreadId}
                        onOpenChange={(isOpen) => {
                          setDropdownToolsAvailable(isOpen)
                          if (isOpen) setTooltipToolsAvailable(false)
                        }}
                      >
                        {() => (
                          <div className="p-1 flex items-center justify-center rounded-sm transition-all duration-200 ease-in-out gap-1 cursor-pointer">
                            <Wrench
                              size={18}
                              className="text-muted-foreground"
                            />
                          </div>
                        )}
                      </DropdownToolsAvailable>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {selectedModelHasTools
                        ? t('tools')
                        : 'Tools available, but the selected model is not marked as tool-capable'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ))}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={toggleLocalKnowledge}
                >
                  <Database
                    size={18}
                    className={cn(
                      isLocalKnowledgeEnabled
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  Local Knowledge{isLocalKnowledgeEnabled ? ' (active)' : ''}
                </p>
              </TooltipContent>
            </Tooltip>

            {selectedModel?.capabilities?.includes('reasoning') && (
              <ToolbarIndicator
                icon={Atom}
                iconClassName="text-muted-foreground/70"
                tooltip={<p>{t('reasoning')}</p>}
              />
            )}
          </div>
        </div>

        {/* Right: keyboard hints + token counter + send/stop */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground/50 mr-1">
            <span>⏎ Send</span>
            <span>⇧⏎ Newline</span>
          </div>

          {tokenCounterCompact &&
            !initialMessage &&
            (threadMessages?.length > 0 || prompt.trim().length > 0) && (
              <div className="flex-1 flex justify-center">
                <TokenCounter messages={threadMessages || []} />
              </div>
            )}

          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon-sm"
              className="rounded-full mr-1 mb-1"
              onClick={() => {
                if (effectiveThreadId) stopStreaming(effectiveThreadId)
              }}
            >
              <Square />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon-sm"
              disabled={ingestingDocs}
              data-test-id="send-message-button"
              onClick={() => {
                if (submitCurrentPrompt) {
                  submitCurrentPrompt()
                } else {
                  void handleSendMessage(prompt)
                }
              }}
              className="rounded-full mr-1 mb-1 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white border-0 shadow-sm"
            >
              <ArrowUp className="text-white" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
})
