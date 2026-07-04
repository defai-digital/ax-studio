import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  MessageSquare,
  Search,
  Plus,
  FolderPlus,
  Settings,
  Settings2,
  Plug,
  Palette,
  Server,
  ServerCog,
  Cpu,
  History,
  FolderOpen,
  Blocks,
  Bot,
  Lock,
  ShieldCheck,
  Paperclip,
  Route as RouteIcon,
  Keyboard,
  Puzzle,
  Network,
} from 'lucide-react'
import Fuse from 'fuse.js'
import { useThreads } from '@/hooks/threads/useThreads'
import { useProjectDialog } from '@/hooks/ui/useProjectDialog'
import { localStorageKey } from '@/constants/localStorage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

const MAX_RECENT_SEARCHES = 5

type Tab = 'all' | 'chats' | 'commands'

interface CommandItem {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon: React.ElementType
  category: string
  action: () => void
}

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function readRecentSearchThreadIds() {
  const stored = safeStorageGetItem(
    localStorage,
    localStorageKey.recentSearches,
    'SearchDialog'
  )
  if (!stored) return []

  try {
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [recentThreadIds, setRecentThreadIds] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const threads = useThreads((state) => state.threads)
  const { setOpen: setProjectDialogOpen } = useProjectDialog()

  const handleClose = useCallback(() => {
    setSearchQuery('')
    setActiveTab('all')
    onOpenChange(false)
  }, [onOpenChange])

  // Commands list
  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'new-chat',
        label: t('common:newChat'),
        keywords: ['new', 'chat', 'conversation', 'create'],
        icon: Plus,
        category: t('common:actions'),
        action: () => {
          handleClose()
          navigate({ to: '/' })
        },
      },
      {
        id: 'new-project',
        label: t('projects.newProject', { defaultValue: 'New Project' }),
        keywords: ['new', 'project', 'create', 'folder'],
        icon: FolderPlus,
        category: t('common:actions'),
        action: () => {
          handleClose()
          setProjectDialogOpen(true)
        },
      },
      {
        id: 'hub',
        label: t('hub:title', { defaultValue: 'Model Hub' }),
        keywords: ['hub', 'models', 'download', 'browse'],
        icon: Blocks,
        category: t('common:navigate'),
        action: () => {
          handleClose()
          navigate({ to: route.hub.index })
        },
      },
      {
        id: 'settings',
        label: t('common:settings'),
        keywords: ['settings', 'preferences', 'config'],
        icon: Settings,
        category: t('common:navigate'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.general })
        },
      },
      {
        id: 'providers',
        label: t('settings:providers', {
          defaultValue: 'Model Providers',
        }),
        keywords: ['providers', 'api', 'keys', 'openai', 'anthropic'],
        icon: Plug,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.model_providers })
        },
      },
      {
        id: 'appearance',
        label: t('settings:interface.title', {
          defaultValue: 'Appearance',
        }),
        keywords: ['appearance', 'theme', 'dark', 'light', 'interface'],
        icon: Palette,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.interface })
        },
      },
      {
        id: 'mcp',
        label: t('settings:mcpServers.title', {
          defaultValue: 'MCP Servers',
        }),
        keywords: ['mcp', 'servers', 'tools', 'plugins'],
        icon: Server,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.mcp_servers })
        },
      },
      {
        id: 'hardware',
        label: t('settings:hardware.title', { defaultValue: 'Hardware' }),
        keywords: ['hardware', 'gpu', 'cpu', 'memory', 'system'],
        icon: Cpu,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.hardware })
        },
      },
      {
        id: 'assistants',
        label: t('common:assistants', { defaultValue: 'Assistants' }),
        keywords: ['assistant', 'assistants', 'persona', 'agent', 'system prompt'],
        icon: Bot,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.assistant })
        },
      },
      {
        id: 'general',
        label: t('settings:general.title', { defaultValue: 'General' }),
        keywords: ['general', 'language', 'data folder', 'reset', 'version'],
        icon: Settings2,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.general })
        },
      },
      {
        id: 'privacy',
        label: t('settings:privacy.title', { defaultValue: 'Privacy' }),
        keywords: ['privacy', 'telemetry', 'analytics', 'data'],
        icon: Lock,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.privacy })
        },
      },
      {
        id: 'guardrails',
        label: t('settings:guardrails.title', { defaultValue: 'Guardrails' }),
        keywords: ['guardrails', 'safety', 'confidence', 'moderation'],
        icon: ShieldCheck,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.guardrails })
        },
      },
      {
        id: 'attachments',
        label: t('settings:attachments.title', { defaultValue: 'Attachments' }),
        keywords: ['attachments', 'files', 'documents', 'upload', 'rag'],
        icon: Paperclip,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.attachments })
        },
      },
      {
        id: 'llm-router',
        label: t('settings:llmRouter.title', { defaultValue: 'LLM Router' }),
        keywords: ['router', 'routing', 'auto', 'model selection', 'llm'],
        icon: RouteIcon,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.llm_router })
        },
      },
      {
        id: 'shortcuts',
        label: t('settings:shortcuts.title', {
          defaultValue: 'Keyboard Shortcuts',
        }),
        keywords: ['keyboard', 'shortcuts', 'hotkeys', 'keybindings'],
        icon: Keyboard,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.shortcuts })
        },
      },
      {
        id: 'local-api-server',
        label: t('settings:localApiServer.title', {
          defaultValue: 'Local API Server',
        }),
        keywords: ['api', 'server', 'local', 'openai compatible', 'endpoint'],
        icon: ServerCog,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.local_api_server })
        },
      },
      {
        id: 'https-proxy',
        label: t('settings:httpsProxy.title', { defaultValue: 'HTTPS Proxy' }),
        keywords: ['proxy', 'https', 'network', 'vpn'],
        icon: Network,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.https_proxy })
        },
      },
      {
        id: 'extensions',
        label: t('settings:extensions.title', { defaultValue: 'Extensions' }),
        keywords: ['extensions', 'plugins', 'addons'],
        icon: Puzzle,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.extensions })
        },
      },
    ],
    [t, handleClose, navigate, setProjectDialogOpen],
  )

  // Build thread list for Fuse search
  const threadList = useMemo(() => {
    return Object.values(threads).filter((t) => t.id !== TEMPORARY_CHAT_ID)
  }, [threads])

  // Fuse instances
  const threadFuse = useMemo(
    () =>
      new Fuse(threadList, {
        keys: [{ name: 'title', weight: 1.0 }],
        threshold: 0.4,
        includeScore: true,
      }),
    [threadList],
  )

  const commandFuse = useMemo(
    () =>
      new Fuse(commands, {
        keys: [
          { name: 'label', weight: 0.6 },
          { name: 'description', weight: 0.25 },
          { name: 'keywords', weight: 0.15 },
        ],
        threshold: 0.3,
        includeScore: true,
      }),
    [commands],
  )

  // Focus input when dialog opens
  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    if (open) {
      setSearchQuery('')
      setSelectedIndex(0)
      setActiveTab('all')
      setRecentThreadIds(readRecentSearchThreadIds())
      focusTimer = setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    }

    return () => {
      if (focusTimer) clearTimeout(focusTimer)
    }
  }, [open])

  // Load recent searches from localStorage
  const recentSearches = useMemo(() => {
    if (!open) return []
    return recentThreadIds
      .map((id) => threads[id])
      .filter((thread): thread is Thread => thread !== undefined)
      .slice(0, MAX_RECENT_SEARCHES)
  }, [open, recentThreadIds, threads])

  const handleClearRecent = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    safeStorageRemoveItem(
      localStorage,
      localStorageKey.recentSearches,
      'SearchDialog'
    )
    setRecentThreadIds([])
  }

  const handleSelectThread = useCallback(
    (threadId: string) => {
      const nextThreadIds = readRecentSearchThreadIds()
        .filter((id) => id !== threadId)
        .slice(0, MAX_RECENT_SEARCHES - 1)
      nextThreadIds.unshift(threadId)

      safeStorageSetItem(
        localStorage,
        localStorageKey.recentSearches,
        JSON.stringify(nextThreadIds),
        'SearchDialog'
      )
      setRecentThreadIds(nextThreadIds)

      handleClose()
      navigate({ to: route.threadsDetail, params: { threadId } })
    },
    [handleClose, navigate]
  )

  // Filtered results
  const filteredThreads = useMemo(() => {
    if (!searchQuery) return []
    return threadFuse.search(searchQuery).map((r) => r.item)
  }, [searchQuery, threadFuse])

  const filteredCommands = useMemo(() => {
    if (!searchQuery) return commands
    return commandFuse.search(searchQuery).map((r) => r.item)
  }, [searchQuery, commandFuse, commands])

  // Build all items list for keyboard navigation
  const allItems = useMemo(() => {
    const items: Array<{
      type: 'chat' | 'command' | 'recent'
      id: string
      thread?: Thread
      command?: CommandItem
    }> = []

    if (!searchQuery) {
      // No query: show commands + recent chats
      if (activeTab === 'all' || activeTab === 'commands') {
        commands.forEach((cmd) => {
          items.push({ type: 'command', id: cmd.id, command: cmd })
        })
      }
      if (activeTab === 'all' || activeTab === 'chats') {
        recentSearches.forEach((thread) => {
          items.push({ type: 'recent', id: thread.id, thread })
        })
      }
    } else {
      // With query: show filtered results
      if (activeTab === 'all' || activeTab === 'chats') {
        filteredThreads.forEach((thread) => {
          items.push({ type: 'chat', id: thread.id, thread })
        })
      }
      if (activeTab === 'all' || activeTab === 'commands') {
        filteredCommands.forEach((cmd) => {
          items.push({ type: 'command', id: cmd.id, command: cmd })
        })
      }
    }

    return items
  }, [
    searchQuery,
    activeTab,
    commands,
    recentSearches,
    filteredThreads,
    filteredCommands,
  ])

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [allItems.length, activeTab])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      )
      selectedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const executeSelected = useCallback(() => {
    const selectedItem = allItems[selectedIndex]
    if (!selectedItem) return

    if (selectedItem.type === 'command' && selectedItem.command) {
      selectedItem.command.action()
    } else if (selectedItem.thread) {
      handleSelectThread(selectedItem.thread.id)
    }
  }, [allItems, handleSelectThread, selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      executeSelected()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      // Cycle tabs: all → chats → commands → all
      setActiveTab((prev) =>
        prev === 'all' ? 'chats' : prev === 'chats' ? 'commands' : 'all',
      )
    }
  }

  // Group commands by category for display
  const groupedCommands = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    const cmds = searchQuery ? filteredCommands : commands
    cmds.forEach((cmd) => {
      if (!groups[cmd.category]) groups[cmd.category] = []
      groups[cmd.category].push(cmd)
    })
    return groups
  }, [searchQuery, filteredCommands, commands])

  // Calculate item index offset for commands
  const getCommandIndex = (cmd: CommandItem) => {
    return allItems.findIndex((item) => item.id === cmd.id)
  }

  const getThreadIndex = (threadId: string) => {
    return allItems.findIndex((item) => item.id === threadId)
  }

  const showChats = activeTab === 'all' || activeTab === 'chats'
  const showCommands = activeTab === 'all' || activeTab === 'commands'

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('common:all', { defaultValue: 'All' }) },
    { key: 'chats', label: t('common:chats', { defaultValue: 'Chats' }) },
    {
      key: 'commands',
      label: t('common:commands', { defaultValue: 'Commands' }),
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <VisuallyHidden>
          <DialogTitle>{t('common:search')}</DialogTitle>
        </VisuallyHidden>

        {/* Search Input */}
        <div className="flex items-center border-b border-border/50 px-3">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t('common:searchThreads')}
            className="flex-1 h-12 px-3 bg-transparent text-[14px] placeholder:text-muted-foreground outline-none focus-visible:ring-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t('common:search')}
          />
        </div>

        {/* Tab Filter */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border/50" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                activeTab === tab.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto px-1 py-2" role="listbox">
          {/* Empty state */}
          {searchQuery &&
            allItems.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Search className="size-6 text-muted-foreground mb-2" />
                <h3 className="text-base font-medium mb-1">
                  {t('common:noResultsFound')}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground w-1/2 mx-auto">
                  {t('common:noResultsFoundDesc')}
                </p>
              </div>
            )}

          {/* Commands section */}
          {showCommands &&
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="p-1">
                <div className="px-3 pt-1.5 mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                    {category}
                  </span>
                </div>
                {cmds.map((cmd) => {
                  const itemIndex = getCommandIndex(cmd)
                  const Icon = cmd.icon
                  return (
                    <button
                      key={cmd.id}
                      role="option"
                      aria-selected={selectedIndex === itemIndex}
                      data-index={itemIndex}
                      onClick={() => cmd.action()}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors cursor-pointer',
                        selectedIndex === itemIndex && 'bg-muted/50',
                      )}
                    >
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-[13px]">{cmd.label}</span>
                    </button>
                  )
                })}
              </div>
            ))}

          {/* Recent chats - shown when no search query */}
          {!searchQuery && showChats && recentSearches.length > 0 && (
            <div className="p-1">
              <div className="px-3 pt-1.5 flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                  {t('common:recents')}
                </span>
                <button
                  onClick={handleClearRecent}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  {t('common:clearRecent')}
                </button>
              </div>
              {recentSearches.map((thread) => {
                const itemIndex = getThreadIndex(thread.id)
                return (
                  <button
                    key={thread.id}
                    role="option"
                    aria-selected={selectedIndex === itemIndex}
                    data-index={itemIndex}
                    onClick={() => handleSelectThread(thread.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors cursor-pointer',
                      selectedIndex === itemIndex && 'bg-muted/50',
                    )}
                  >
                    <History className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-[13px] truncate">
                      {thread.title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Search results - chats */}
          {searchQuery && showChats && filteredThreads.length > 0 && (
            <div className="p-1">
              <div className="px-3 pt-1.5 mb-1">
                <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                  {t('common:chats', { defaultValue: 'Chats' })}
                </span>
              </div>
              {filteredThreads.map((thread) => {
                const itemIndex = getThreadIndex(thread.id)
                const projectName = thread.metadata?.project?.name
                return (
                  <button
                    key={thread.id}
                    role="option"
                    aria-selected={selectedIndex === itemIndex}
                    data-index={itemIndex}
                    onClick={() => handleSelectThread(thread.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors cursor-pointer',
                      selectedIndex === itemIndex && 'bg-muted/50',
                    )}
                  >
                    <MessageSquare className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex items-center min-w-0">
                      {projectName && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 mr-1.5">
                          <FolderOpen className="size-3" />
                          {projectName}
                          <span className="mx-0.5">·</span>
                        </span>
                      )}
                      <span className="text-[13px] truncate">
                        {thread.title}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/50 border border-border/50 rounded text-[10px]">
                ↑↓
              </kbd>
              {t('common:toNavigate')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/50 border border-border/50 rounded text-[10px]">
                ↵
              </kbd>
              {t('common:toSelect')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/50 border border-border/50 rounded text-[10px]">
                tab
              </kbd>
              {t('common:filter', { defaultValue: 'Filter' })}
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted/50 border border-border/50 rounded text-[10px]">
              esc
            </kbd>
            {t('common:toClose')}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
