import {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
  useSyncExternalStore,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  MessageSquare,
  Search,
  Plus,
  Settings,
  Settings2,
  BarChart3,
  Cpu,
  Plug,
  History,
  FolderOpen,
  Blocks,
  Sparkles,
} from 'lucide-react'
import Fuse from 'fuse.js'
import { toast } from 'sonner'
import { useThreads } from '@/hooks/threads/useThreads'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { getModelDisplayName } from '@/lib/utils'
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
import { useChatOrganizationStore } from '@/hooks/threads/useChatOrganization'
import { usePinnedThreads } from '@/hooks/threads/usePinnedThreads'
import {
  parseSearchQuery,
  resolveSearchFilters,
} from '@/lib/search/parse-search-query'
import {
  ensureMessageSearchIndex,
  getMessageSearchIndexSnapshot,
  subscribeMessageSearchIndex,
} from '@/lib/search/message-search-index'

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

const SNIPPET_CONTEXT_CHARS = 40

type SnippetSegment = { text: string; matched: boolean }

/**
 * Build snippet segments for a Fuse content match: a window of
 * ~`contextChars` around the most significant matched range, flagged for
 * <mark> highlighting.
 */
const buildContentSnippet = (
  content: string,
  indices: ReadonlyArray<readonly [number, number]>,
  contextChars: number = SNIPPET_CONTEXT_CHARS
): SnippetSegment[] => {
  if (indices.length === 0) return []

  // Fuse reports every scattered character hit in the field; the longest
  // contiguous range is the meaningful match to center the snippet on.
  const [anchorStart, anchorEnd] = indices.reduce((longest, range) =>
    range[1] - range[0] > longest[1] - longest[0] ? range : longest
  )
  const windowStart = Math.max(0, anchorStart - contextChars)
  // Fuse ranges are inclusive.
  const windowEnd = Math.min(content.length, anchorEnd + 1 + contextChars)

  const segments: SnippetSegment[] = []
  const pushText = (text: string, matched: boolean) => {
    if (text) segments.push({ text, matched })
  }

  if (windowStart > 0) pushText('…', false)
  pushText(content.slice(windowStart, anchorStart), false)
  pushText(content.slice(anchorStart, anchorEnd + 1), true)
  pushText(content.slice(anchorEnd + 1, windowEnd), false)
  if (windowEnd < content.length) pushText('…', false)

  return segments
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
    if (!Array.isArray(parsed)) return []

    const ids: string[] = []
    const seen = new Set<string>()
    for (const id of parsed) {
      if (typeof id !== 'string' || id.trim() === '' || seen.has(id)) {
        continue
      }

      ids.push(id)
      seen.add(id)
      if (ids.length >= MAX_RECENT_SEARCHES) break
    }

    return ids
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
  const updateCurrentThreadModel = useThreads(
    (state) => state.updateCurrentThreadModel
  )
  const folders = useChatOrganizationStore((state) => state.folders)
  const tags = useChatOrganizationStore((state) => state.tags)
  const { pinnedSet } = usePinnedThreads()
  const messageIndex = useSyncExternalStore(
    subscribeMessageSearchIndex,
    getMessageSearchIndexSnapshot,
    getMessageSearchIndexSnapshot
  )
  const providers = useModelProvider((state) => state.providers)
  const selectModelProvider = useModelProvider(
    (state) => state.selectModelProvider
  )

  const handleClose = useCallback(() => {
    setSearchQuery('')
    setActiveTab('all')
    onOpenChange(false)
  }, [onOpenChange])

  // Commands list
  const commands: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [
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
          defaultValue: 'Cloud Model Providers',
        }),
        keywords: ['cloud', 'providers', 'api', 'keys', 'openai', 'anthropic'],
        icon: Plug,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.model_providers })
        },
      },
      {
        id: 'ax-engine',
        label: t('common:axEngine', { defaultValue: 'AX Engine' }),
        keywords: ['ax engine', 'local model', 'mlx', 'runtime'],
        icon: Cpu,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.axEngine })
        },
      },
      {
        id: 'ax-bi',
        label: t('common:axBi', { defaultValue: 'AX BI' }),
        keywords: ['ax bi', 'analytics', 'chart', 'dashboard', 'mcp'],
        icon: BarChart3,
        category: t('common:settings'),
        action: () => {
          handleClose()
          navigate({ to: route.settings.axBi })
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
    ]
    return items
  }, [t, handleClose, navigate])

  // Dynamic commands: one per model of every active provider. These are only
  // surfaced via search (not the empty-state list), and selecting one switches
  // the active model exactly as the composer picker does.
  const modelCommands: CommandItem[] = useMemo(() => {
    const modelsCategory = t('common:models', { defaultValue: 'Models' })
    const items: CommandItem[] = []
    for (const provider of providers) {
      if (!provider.active) continue
      for (const model of provider.models ?? []) {
        const name = getModelDisplayName(model)
        items.push({
          id: `model-${provider.provider}-${model.id}`,
          label: name,
          description: provider.provider,
          keywords: [model.id, provider.provider, 'model', 'switch'],
          icon: Sparkles,
          category: modelsCategory,
          action: () => {
            handleClose()
            selectModelProvider(provider.provider, model.id)
            updateCurrentThreadModel({
              id: model.id,
              provider: provider.provider,
            })
            safeStorageSetItem(
              localStorage,
              localStorageKey.lastUsedModel,
              JSON.stringify({ provider: provider.provider, model: model.id }),
              'SearchDialog'
            )
            toast(`Switched to ${name}`)
          },
        })
      }
    }
    return items
  }, [providers, t, handleClose, selectModelProvider, updateCurrentThreadModel])

  // Build thread list for Fuse search
  const threadList = useMemo(() => {
    return Object.values(threads).filter((t) => t.id !== TEMPORARY_CHAT_ID)
  }, [threads])

  // Query syntax: `folder:` / `tag:` / `is:pinned` prefixes + free text.
  const parsedQuery = useMemo(
    () => parseSearchQuery(searchQuery),
    [searchQuery]
  )
  const filters = useMemo(
    () => resolveSearchFilters(parsedQuery, { folders, tags }),
    [parsedQuery, folders, tags]
  )
  const hasPrefixFilters =
    filters.folderId !== undefined ||
    filters.tagId !== undefined ||
    filters.pinnedOnly

  // Kick off background message-content indexing once the free text is
  // specific enough; a stale fingerprint rebuilds automatically.
  useEffect(() => {
    if (open && parsedQuery.freeText.trim().length >= 2) {
      ensureMessageSearchIndex(threads)
    }
  }, [open, parsedQuery.freeText, threads])

  // Apply prefix filters as predicates BEFORE Fuse, then attach each
  // thread's indexed message content as a searchable field.
  const threadSearchDocs = useMemo(() => {
    return threadList
      .filter((thread) => {
        if (filters.folderId !== undefined) {
          if (filters.folderId === null) return false
          if (thread.metadata?.folderId !== filters.folderId) return false
        }
        if (filters.tagId !== undefined) {
          if (filters.tagId === null) return false
          if (!(thread.metadata?.tagIds ?? []).includes(filters.tagId)) {
            return false
          }
        }
        if (filters.pinnedOnly && !pinnedSet.has(thread.id)) return false
        return true
      })
      .map((thread) => ({
        thread,
        title: thread.title,
        content: messageIndex.documents.get(thread.id) ?? '',
      }))
  }, [threadList, filters, pinnedSet, messageIndex])

  // Fuse instances
  const threadFuse = useMemo(
    () =>
      new Fuse(threadSearchDocs, {
        keys: [
          { name: 'title', weight: 1.0 },
          { name: 'content', weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
        includeMatches: true,
        // Long content fields: don't penalize matches far from index 0 —
        // otherwise fuzzy near-misses at the top outscore exact substrings.
        ignoreLocation: true,
      }),
    [threadSearchDocs]
  )

  const commandFuse = useMemo(
    () =>
      // Index static commands + every model so a query like "gpt" surfaces
      // models. The empty-state list still shows only the static commands.
      new Fuse([...commands, ...modelCommands], {
        keys: [
          { name: 'label', weight: 0.6 },
          { name: 'description', weight: 0.25 },
          { name: 'keywords', weight: 0.15 },
        ],
        threshold: 0.3,
        includeScore: true,
      }),
    [commands, modelCommands]
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
        .filter((id) => id !== threadId && threads[id] !== undefined)
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
    [handleClose, navigate, threads]
  )

  // Filtered chat results: prefix-only queries list every matching thread;
  // free text goes through Fuse. Results are recency-biased (updated desc)
  // and carry a content snippet when they matched on message content.
  const chatResults = useMemo(() => {
    if (!searchQuery) return []
    const freeText = parsedQuery.freeText.trim()
    if (!freeText && !hasPrefixFilters) return []

    const results = freeText
      ? threadFuse.search(freeText)
      : threadSearchDocs.map((item) => ({ item, matches: undefined }))

    return results
      .map((result) => {
        const contentMatch = result.matches?.find(
          (match) => match.key === 'content' && match.indices.length > 0
        )
        return {
          thread: result.item.thread,
          snippet: contentMatch
            ? buildContentSnippet(
                contentMatch.value ?? result.item.content,
                contentMatch.indices
              )
            : undefined,
        }
      })
      .sort((a, b) => b.thread.updated - a.thread.updated)
  }, [searchQuery, parsedQuery, hasPrefixFilters, threadFuse, threadSearchDocs])

  const filteredCommands = useMemo(() => {
    if (!searchQuery) return commands
    const freeText = parsedQuery.freeText.trim()
    if (freeText) return commandFuse.search(freeText).map((r) => r.item)
    // Prefix-only queries filter chats; they don't apply to commands.
    if (hasPrefixFilters) return []
    return commandFuse.search(searchQuery).map((r) => r.item)
  }, [searchQuery, parsedQuery, hasPrefixFilters, commandFuse, commands])

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
        chatResults.forEach(({ thread }) => {
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
    chatResults,
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
        `[data-index="${selectedIndex}"]`
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
        prev === 'all' ? 'chats' : prev === 'chats' ? 'commands' : 'all'
      )
    }
  }

  // Group commands by category for display
  const groupedCommands = useMemo(() => {
    const groups = Object.create(null) as Record<string, CommandItem[]>
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
        <div
          className="flex items-center gap-1 px-3 py-2 border-b border-border/50"
          role="tablist"
        >
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
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto px-1 py-2"
          role="listbox"
        >
          {/* Empty state */}
          {searchQuery && allItems.length === 0 && (
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
                        selectedIndex === itemIndex && 'bg-muted/50'
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
                      selectedIndex === itemIndex && 'bg-muted/50'
                    )}
                  >
                    <History className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-[13px] truncate">{thread.title}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Search results - chats */}
          {searchQuery && showChats && chatResults.length > 0 && (
            <div className="p-1">
              <div className="px-3 pt-1.5 mb-1">
                <span className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
                  {t('common:chats', { defaultValue: 'Chats' })}
                </span>
              </div>
              {chatResults.map(({ thread, snippet }) => {
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
                      selectedIndex === itemIndex && 'bg-muted/50'
                    )}
                  >
                    <MessageSquare className="size-4 text-muted-foreground shrink-0 self-start mt-0.5" />
                    <div className="flex flex-col min-w-0">
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
                      {snippet && (
                        <span className="text-[12px] text-muted-foreground truncate">
                          {snippet.map((segment, segmentIndex) =>
                            segment.matched ? (
                              <mark
                                key={segmentIndex}
                                className="bg-primary/25 text-foreground rounded-[3px]"
                              >
                                {segment.text}
                              </mark>
                            ) : (
                              <span key={segmentIndex}>{segment.text}</span>
                            )
                          )}
                        </span>
                      )}
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
            {messageIndex.status === 'indexing' && (
              <span
                className="flex items-center gap-1"
                data-testid="indexing-indicator"
              >
                {t('common:indexingMessages')}
              </span>
            )}
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
