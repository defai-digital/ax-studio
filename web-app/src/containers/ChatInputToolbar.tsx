/**
 * ChatInputToolbar — the bottom action bar of ChatInput.
 *
 * Renders: attachment dropdown, capability toggles (tools, memory, reasoning),
 * token counter, and the send/stop button. Pure UI — no data fetching.
 */
import { memo } from 'react'
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
import { ArrowRight, PlusIcon, AppWindowIcon, SearchIcon } from 'lucide-react'
import {
  IconAtom,
  IconTool,
  IconCodeCircle2,
  IconPlayerStopFilled,
  IconUser,
  IconBrain,
  IconHierarchy2,
} from '@tabler/icons-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { TokenCounter } from '@/components/TokenCounter'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import DropdownToolsAvailable from '@/containers/DropdownToolsAvailable'
import { McpExtensionToolLoader } from './McpExtensionToolLoader'
import type { ThreadMessage } from '@ax-studio/core'

const ARTIFACT_PROMPTS = [
  { label: 'HTML Page',        prompt: 'Build an artifact-html page for '            },
  { label: 'React Component',  prompt: 'Build an artifact-react component for '      },
  { label: 'SVG Graphic',      prompt: 'Create an artifact-svg illustration of '     },
  { label: 'Chart.js Chart',   prompt: 'Create an artifact-chartjs chart showing '   },
  { label: 'Vega-Lite Chart',  prompt: 'Create an artifact-vega chart showing '      },
] as const

const DIAGRAM_PROMPTS = [
  { label: 'Flowchart',        prompt: 'Draw a flowchart for '                        },
  { label: 'Sequence Diagram', prompt: 'Draw a sequence diagram showing '             },
  { label: 'Class Diagram',    prompt: 'Draw a class diagram for '                    },
  { label: 'ER Diagram',       prompt: 'Draw an ER diagram for '                      },
  { label: 'State Machine',    prompt: 'Draw a state diagram for '                    },
  { label: 'Gantt Chart',      prompt: 'Create a Gantt chart for '                    },
  { label: 'Mind Map',         prompt: 'Create a mind map for '                       },
] as const

const RESEARCH_PROMPTS = [
  { label: 'Standard', prompt: '/research:standard ', description: 'Balanced depth with page scraping' },
  { label: 'Deep',     prompt: '/research:deep ',     description: 'Thorough multi-level research'     },
] as const

type Props = {
  // Layout state
  isStreaming: boolean
  prompt: string
  // Textarea ref (for quick-prompt focus)
  textareaRef: React.RefObject<HTMLTextAreaElement>
  setPrompt: (v: string) => void
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
  tools: Tool[]
  hasActiveMCPServers: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MCPToolComponent: any
  dropdownToolsAvailable: boolean
  setDropdownToolsAvailable: (v: boolean) => void
  tooltipToolsAvailable: boolean
  setTooltipToolsAvailable: (v: boolean) => void
  // Memory
  isMemoryEnabled: boolean
  toggleMemory: () => void
  memoryCount: number
  // Token counter
  tokenCounterCompact: boolean
  threadMessages: ThreadMessage[]
  // Actions
  stopStreaming: (threadId: string) => void
  handleSendMessage: (prompt: string) => Promise<void>
}

export const ChatInputToolbar = memo(function ChatInputToolbar({
  isStreaming,
  prompt,
  textareaRef,
  setPrompt,
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
  isMemoryEnabled,
  toggleMemory,
  memoryCount,
  tokenCounterCompact,
  threadMessages,
  stopStreaming,
  handleSendMessage,
}: Props) {
  const { t } = useTranslation()

  const applyQuickPrompt = (value: string) => {
    setPrompt(value)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const len = textareaRef.current.value.length
        textareaRef.current.setSelectionRange(len, len)
      }
    }, 0)
  }

  return (
    <div className="absolute z-20 bg-transparent bottom-0 w-full p-2">
      <div className="flex justify-between items-center w-full">
        {/* Left: action buttons */}
        <div className="px-1 flex items-center gap-1 flex-1 min-w-0">
          <div
            className={cn(
              'px-1 flex items-center w-full gap-1',
              isStreaming && 'opacity-50 pointer-events-none'
            )}
          >
            {/* Attachment + quick-prompt dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon-sm" className="rounded-full mr-2 mb-1">
                  <PlusIcon size={18} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {!projectId && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <IconUser size={18} className="text-muted-foreground" />
                      <span>Use Assistant</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem
                        className={!selectedAssistant && !currentThread?.assistants?.length ? 'bg-accent' : ''}
                        onClick={() => {
                          setSelectedAssistant(undefined)
                          if (effectiveThreadId) updateCurrentThreadAssistant(undefined)
                        }}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="text-muted-foreground">—</span>
                          <span>None</span>
                          {!selectedAssistant && !currentThread?.assistants?.length && (
                            <span className="ml-auto text-xs text-muted-foreground">✓</span>
                          )}
                        </div>
                      </DropdownMenuItem>
                      {assistants.length > 0 ? (
                        assistants.map((assistant) => {
                          const isSelected =
                            (initialMessage && selectedAssistant?.id === assistant.id) ||
                            (assistant && currentThread?.assistants?.some((a) => a.id === assistant.id))
                          return (
                            <DropdownMenuItem
                              key={assistant.id}
                              className={isSelected ? 'bg-accent' : ''}
                              onClick={() => {
                                setSelectedAssistant(assistant)
                                if (effectiveThreadId) updateCurrentThreadAssistant(assistant)
                              }}
                            >
                              <div className="flex items-center gap-2 w-full">
                                <AvatarEmoji
                                  avatar={assistant.avatar}
                                  imageClassName="w-4 h-4 object-contain"
                                  textClassName="text-sm"
                                />
                                <span>{assistant.name || 'Unnamed Assistant'}</span>
                                {isSelected && (
                                  <span className="ml-auto text-xs text-muted-foreground">✓</span>
                                )}
                              </div>
                            </DropdownMenuItem>
                          )
                        })
                      ) : (
                        <DropdownMenuItem disabled>
                          <span className="text-muted-foreground">No assistants available</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <AppWindowIcon size={18} className="text-muted-foreground" />
                    <span>Generate Artifact</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {ARTIFACT_PROMPTS.map(({ label, prompt: p }) => (
                      <DropdownMenuItem key={label} onClick={() => applyQuickPrompt(p)}>
                        <span>{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <IconHierarchy2 size={18} className="text-muted-foreground" />
                    <span>Generate Diagram</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {DIAGRAM_PROMPTS.map(({ label, prompt: p }) => (
                      <DropdownMenuItem key={label} onClick={() => applyQuickPrompt(p)}>
                        <span>{label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <SearchIcon size={18} className="text-muted-foreground" />
                    <span>Deep Research</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {RESEARCH_PROMPTS.map(({ label, prompt: p, description }) => (
                      <DropdownMenuItem key={label} onClick={() => applyQuickPrompt(p)}>
                        <div className="flex flex-col gap-0.5">
                          <span>{label}</span>
                          <span className="text-[11px] text-muted-foreground">{description}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedModel?.capabilities?.includes('embeddings') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs">
                    <IconCodeCircle2 size={18} className="text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{t('embeddings')}</p></TooltipContent>
              </Tooltip>
            )}

            {selectedModel?.capabilities?.includes('tools') && hasActiveMCPServers && (
              MCPToolComponent ? (
                <McpExtensionToolLoader
                  tools={tools}
                  hasActiveMCPServers={hasActiveMCPServers}
                  selectedModelHasTools={selectedModel?.capabilities?.includes('tools') ?? false}
                  initialMessage={initialMessage}
                  threadId={effectiveThreadId}
                  MCPToolComponent={MCPToolComponent}
                />
              ) : (
                <Tooltip open={tooltipToolsAvailable} onOpenChange={setTooltipToolsAvailable}>
                  <TooltipTrigger asChild disabled={dropdownToolsAvailable}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => { setDropdownToolsAvailable(false); e.stopPropagation() }}
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
                            <IconTool size={18} className="text-muted-foreground" />
                          </div>
                        )}
                      </DropdownToolsAvailable>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p>{t('tools')}</p></TooltipContent>
                </Tooltip>
              )
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="relative" onClick={() => toggleMemory()}>
                  <IconBrain
                    size={18}
                    className={cn(isMemoryEnabled ? 'text-primary' : 'text-muted-foreground')}
                  />
                  {memoryCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[10px] font-medium text-primary-foreground">
                      {memoryCount}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isMemoryEnabled ? `Memory (${memoryCount})` : 'Memory'}</p>
              </TooltipContent>
            </Tooltip>

            {selectedModel?.capabilities?.includes('reasoning') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs">
                    <IconAtom size={18} className="text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{t('reasoning')}</p></TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Right: token counter + send/stop */}
        <div className="flex items-center gap-2">
          {tokenCounterCompact && !initialMessage && (threadMessages?.length > 0 || prompt.trim().length > 0) && (
            <div className="flex-1 flex justify-center">
              <TokenCounter messages={threadMessages || []} compact={true} />
            </div>
          )}

          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon-sm"
              className="rounded-full mr-1 mb-1"
              onClick={() => { if (effectiveThreadId) stopStreaming(effectiveThreadId) }}
            >
              <IconPlayerStopFilled />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon-sm"
              disabled={!prompt.trim()}
              data-test-id="send-message-button"
              onClick={() => handleSendMessage(prompt)}
              className="rounded-full mr-1 mb-1"
            >
              <ArrowRight className="text-primary-fg" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
})
