import { useEffect, useState, useRef, useMemo, useCallback, memo } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { cn, getProviderTitle, getModelDisplayName, getProviderColor } from '@/lib/utils'
import { highlightFzfMatch } from '@/lib/utils/highlight'
import Capabilities from '@/components/common/Capabilities'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/threads/useThreads'
import { ModelSetting } from '@/containers/ModelSetting'
import { Fzf } from 'fzf'
import { localStorageKey } from '@/constants/localStorage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useFavoriteModel } from '@/hooks/models/useFavoriteModel'
import { predefinedProviders } from '@/constants/providers'
import { ChevronDown, Search, Check, Star, CircleOff, Settings, X, Route } from 'lucide-react'
import { getLastUsedModel } from '@/lib/utils/getModelToStart'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRouterSettings } from '@/hooks/settings/useRouterSettings'

type DropdownModelProviderProps = {
  model?: ThreadModel
  useLastUsedModel?: boolean
}

/** Format a token count into a human-readable context window string. */
function formatContextWindow(model: Model): string | null {
  // Model metadata may include context window info under various keys
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = model as any
  const tokens: number | undefined =
    m.contextWindow ?? m.context_length ?? m.maxTokens
  if (!tokens || typeof tokens !== 'number') return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M context`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K context`
  return `${tokens} context`
}

interface SearchableModel {
  provider: ModelProvider
  model: Model
  searchStr: string
  value: string
  highlightedId?: string
}

// ── Flat row types for the virtualizer ────────────────────────────────────
type FlatRow =
  | { type: 'fav-header' }
  | { type: 'fav-divider' }
  | { type: 'provider-header'; providerKey: string; providerInfo: ModelProvider }
  | { type: 'model-item'; item: SearchableModel; keyPrefix?: string }
  | { type: 'empty-search'; searchValue: string }

const ROW_HEIGHT_HEADER = 28
const ROW_HEIGHT_ITEM = 36
const ROW_HEIGHT_DIVIDER = 12
const ROW_HEIGHT_EMPTY = 100

/** Virtualize only when the flattened list exceeds this threshold. */
const VIRTUALIZE_THRESHOLD = 80

/** Maximum search results rendered — prevents DOM thrashing on broad queries. */
const MAX_SEARCH_RESULTS = 100

function estimateRowHeight(row: FlatRow) {
  switch (row.type) {
    case 'fav-header':
    case 'provider-header':
      return ROW_HEIGHT_HEADER
    case 'model-item':
      return ROW_HEIGHT_ITEM
    case 'fav-divider':
      return ROW_HEIGHT_DIVIDER
    case 'empty-search':
      return ROW_HEIGHT_EMPTY
  }
}

// Helper functions for localStorage
const setLastUsedModel = (provider: string, model: string) => {
  try {
    localStorage.setItem(
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider, model })
    )
  } catch (error) {
    console.debug('Failed to set last used model in localStorage:', error)
  }
}

// ── Memoized model item row ───────────────────────────────────────────────
type ModelItemProps = {
  searchableModel: SearchableModel
  isSelected: boolean
  isFavorite: boolean
  color: string
  onSelect: (m: SearchableModel) => void
  onToggleFavorite: (m: Model) => void
}

const ModelItem = memo(function ModelItem({
  searchableModel,
  isSelected,
  isFavorite,
  color,
  onSelect,
  onToggleFavorite,
}: ModelItemProps) {
  const capabilities = searchableModel.model.capabilities || []

  return (
    <div
      title={searchableModel.model.id}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(searchableModel)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(searchableModel) }}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer',
        isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'
      )}
    >
      {/* Selection indicator with provider color */}
      <div
        className="size-5 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: color + '20' }}
      >
        {isSelected && <Check className="size-3" style={{ color }} />}
      </div>

      {/* Model info */}
      <div className="flex-1 min-w-0">
        <span
          className={cn('truncate block', isSelected ? 'text-primary' : 'text-foreground/80')}
          style={{ fontSize: '13px', fontWeight: isSelected ? 500 : 400 }}
        >
          {getModelDisplayName(searchableModel.model)}
        </span>
        {(() => {
          const ctx = formatContextWindow(searchableModel.model)
          return ctx ? (
            <span className="text-[11px] text-muted-foreground/40">{ctx}</span>
          ) : null
        })()}
      </div>

      {/* Capability badges — compact (no Radix Tooltips) for performance */}
      {capabilities.length > 0 && (
        <div className="shrink-0">
          <Capabilities capabilities={capabilities} compact />
        </div>
      )}

      {/* Star toggle */}
      <button
        type="button"
        data-testid={`star-toggle-${searchableModel.model.id}`}
        className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite(searchableModel.model)
        }}
      >
        <Star
          className={cn(
            'size-3',
            isFavorite
              ? 'text-amber-500 fill-amber-500'
              : 'text-muted-foreground/30 hover:text-muted-foreground/60'
          )}
        />
      </button>
    </div>
  )
})

// ── Virtualized list (only mounted when row count > VIRTUALIZE_THRESHOLD) ─
type VirtualizedListProps = {
  flatRows: FlatRow[]
  renderRow: (row: FlatRow) => React.ReactNode
  searchValue: string
}

function VirtualizedList({ flatRows, renderRow, searchValue }: VirtualizedListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateRowHeight(flatRows[index]),
    overscan: 8,
  })

  // Reset scroll position when search changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [searchValue])

  return (
    <div
      ref={scrollRef}
      className="max-h-[360px] overflow-y-auto"
      style={{ scrollbarWidth: 'thin' }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(flatRows[virtualRow.index])}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Plain list (small lists — no virtualization overhead) ─────────────────
type PlainListProps = {
  flatRows: FlatRow[]
  renderRow: (row: FlatRow) => React.ReactNode
}

function getRowKey(row: FlatRow, index: number): string {
  switch (row.type) {
    case 'fav-header':
      return 'fav-header'
    case 'fav-divider':
      return 'fav-divider'
    case 'provider-header':
      return `ph-${row.providerKey}`
    case 'model-item':
      return `${row.keyPrefix ?? ''}${row.item.value}`
    case 'empty-search':
      return 'empty-search'
    default:
      return `row-${index}`
  }
}

function PlainList({ flatRows, renderRow }: PlainListProps) {
  return (
    <div className="max-h-[360px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
      {flatRows.map((row, i) => (
        <div key={getRowKey(row, i)}>{renderRow(row)}</div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
const DropdownModelProvider = memo(function DropdownModelProvider({
  model,
  useLastUsedModel = false,
}: DropdownModelProviderProps) {
  // Subscribe to the individual fields this component reads rather than
  // the whole `useModelProvider` state. The full-state subscription
  // forced a re-render on every unrelated mutation (e.g. `deletedModels`
  // updates), which was expensive given the virtualized model list.
  const providers = useModelProvider((s) => s.providers)
  const selectedProvider = useModelProvider((s) => s.selectedProvider)
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const getProviderByName = useModelProvider((s) => s.getProviderByName)
  const selectModelProvider = useModelProvider((s) => s.selectModelProvider)
  const getModelBy = useModelProvider((s) => s.getModelBy)
  const [displayModel, setDisplayModel] = useState<string>('')
  const { updateCurrentThreadModel } = useThreads()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { favoriteModels, toggleFavorite } = useFavoriteModel()
  const routerEnabled = useRouterSettings((s) => s.enabled)
  const routerModelId = useRouterSettings((s) => s.routerModelId)
  const routerProviderId = useRouterSettings((s) => s.routerProviderId)
  const isAutoRouteEnabled = useRouterSettings((s) => s.isAutoRouteEnabled)
  const setThreadOverride = useRouterSettings((s) => s.setThreadOverride)
  const currentThreadId = useThreads((s) => s.currentThreadId)
  const activeThreadId = model?.id ? undefined : currentThreadId
  const isRouterConfigured = routerEnabled && !!routerModelId && !!routerProviderId
  const isAutoActive = isRouterConfigured && isAutoRouteEnabled(activeThreadId)

  // Search state
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // O(1) favorite lookup instead of O(n) per item
  const favoriteIdSet = useMemo(
    () => new Set(favoriteModels.map((f) => f.id)),
    [favoriteModels]
  )

  // Helper function to check if a model exists in providers
  const checkModelExists = useCallback(
    (providerName: string, modelId: string) => {
      const provider = providers.find(
        (p) => p.provider === providerName && p.active
      )
      return provider?.models.find((m) => m.id === modelId)
    },
    [providers]
  )

  // Track whether the user manually selected a model (prevents provider-refresh from reverting)
  const userSelectedRef = useRef(false)

  // Initialize model provider - avoid race conditions with manual selections
  useEffect(() => {
    // Skip re-initialization if the user manually selected a model and
    // the trigger is just a provider list refresh (not a model prop change).
    if (userSelectedRef.current) return

    const initializeModel = () => {
      // Auto select model when existing thread is passed
      if (model) {
        selectModelProvider(model?.provider as string, model?.id as string)
        if (!checkModelExists(model.provider, model.id)) {
          selectModelProvider('', '')
        }
      } else if (useLastUsedModel) {
        // Try to use last used model only when explicitly requested (for new chat)
        const lastUsed = getLastUsedModel()
        if (lastUsed && checkModelExists(lastUsed.provider, lastUsed.model)) {
          selectModelProvider(lastUsed.provider, lastUsed.model)
        } else {
          selectModelProvider('', '')
        }
      }
    }

    initializeModel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    model,
    selectModelProvider,
    updateCurrentThreadModel,
    providers,
    checkModelExists,
    // selectedModel and selectedProvider intentionally excluded to prevent race conditions
  ])

  // Reset the manual-selection guard when the thread model prop changes
  // (e.g. user navigates to a different thread)
  useEffect(() => {
    userSelectedRef.current = false
  }, [model?.id, model?.provider])

  // Update display model when selection changes
  useEffect(() => {
    if (isAutoActive) {
      setDisplayModel('Auto')
    } else if (selectedProvider && selectedModel) {
      setDisplayModel(getModelDisplayName(selectedModel))
    } else {
      setDisplayModel(t('common:selectAModel'))
    }
  }, [selectedProvider, selectedModel, t, isAutoActive])

  // Reset search value when dropdown closes
  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open) {
      requestAnimationFrame(() => setSearchValue(''))
    } else {
      // Focus search input after Radix Popover finishes opening
      requestAnimationFrame(() => {
        searchInputRef.current?.focus()
      })
    }
  }, [])

  // Clear search and focus input
  const onClearSearch = useCallback(() => {
    setSearchValue('')
    searchInputRef.current?.focus()
  }, [])

  // Create searchable items from all models
  const searchableItems = useMemo(() => {
    const items: SearchableModel[] = []

    providers.forEach((provider) => {
      if (!provider.active) return

      provider.models.forEach((modelItem) => {
        // Skip embedding models - they can't be used for chat
        if (modelItem.embedding) return

        // Skip models that require API key but don't have one
        // For custom providers, allow if they have at least one model loaded
        const isPredefined = predefinedProviders.some((e) =>
          e.provider.includes(provider.provider)
        )
        if (
          provider &&
          !provider.api_key?.length &&
          (isPredefined || provider.models.length === 0)
        )
          return

        const capabilities = modelItem.capabilities || []
        const capabilitiesString = capabilities.join(' ')
        const providerTitle = getProviderTitle(provider.provider)

        // Create search string with model id, provider, and capabilities
        const searchStr =
          `${modelItem.id} ${providerTitle} ${provider.provider} ${capabilitiesString}`.toLowerCase()

        items.push({
          provider,
          model: modelItem,
          searchStr,
          value: `${provider.provider}:${modelItem.id}`,
        })
      })
    })

    return items
  }, [providers])

  // Create Fzf instance for fuzzy search
  const fzfInstance = useMemo(() => {
    return new Fzf(searchableItems, {
      selector: (item) =>
        `${getModelDisplayName(item.model)} ${item.model.id}`.toLowerCase(),
    })
  }, [searchableItems])

  // Get favorite models that are currently available
  const favoriteItems = useMemo(() => {
    return searchableItems.filter((item) => favoriteIdSet.has(item.model.id))
  }, [searchableItems, favoriteIdSet])

  // Filter models based on search value — capped for performance
  const filteredItems = useMemo(() => {
    if (!searchValue) return searchableItems

    const results = fzfInstance.find(searchValue.toLowerCase())
    // Cap results to prevent excessive DOM work on broad queries
    const capped = results.length > MAX_SEARCH_RESULTS
      ? results.slice(0, MAX_SEARCH_RESULTS)
      : results

    return capped.map((result) => {
      const item = result.item
      const positions = Array.from(result.positions) || []
      const highlightedId = highlightFzfMatch(
        item.model.id,
        positions,
        'text-accent'
      )

      return {
        ...item,
        highlightedId,
      }
    })
  }, [searchableItems, searchValue, fzfInstance])

  // Group filtered items by provider, excluding favorites when not searching
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchableModel[]> = {}

    if (!searchValue) {
      // When not searching, show all active providers (even without models)
      // Sort: local first, then providers with API keys or custom with models, then others, alphabetically
      const activeProviders = providers
        .filter((p) => p.active)
        .sort((a, b) => {
          // Custom providers without API key but with models should be treated like "have API key"
          const aIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(a.provider)
          )
          const bIsPredefined = predefinedProviders.some((e) =>
            e.provider.includes(b.provider)
          )
          const aHasApiKeyOrCustomModel =
            (a.api_key?.length ?? 0) > 0 ||
            (!aIsPredefined && a.models.length > 0)
          const bHasApiKeyOrCustomModel =
            (b.api_key?.length ?? 0) > 0 ||
            (!bIsPredefined && b.models.length > 0)
          // Providers with API keys or custom with models first
          if (aHasApiKeyOrCustomModel && !bHasApiKeyOrCustomModel) return -1
          if (!aHasApiKeyOrCustomModel && bHasApiKeyOrCustomModel) return 1

          // Sort remaining by provider name
          return a.provider.localeCompare(b.provider)
        })

      activeProviders.forEach((provider) => {
        groups[provider.provider] = []
      })
    }

    // Add the filtered items to their respective groups
    filteredItems.forEach((item) => {
      const providerKey = item.provider.provider
      if (!groups[providerKey]) {
        groups[providerKey] = []
      }

      // When not searching, exclude favorite models from regular provider sections
      if (!searchValue && favoriteIdSet.has(item.model.id)) return

      groups[providerKey].push(item)
    })

    return groups
  }, [filteredItems, providers, searchValue, favoriteIdSet])

  // ── Flatten grouped data into a single row array ────────────────────────
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = []

    // Empty search state
    if (Object.keys(groupedItems).length === 0 && searchValue) {
      rows.push({ type: 'empty-search', searchValue })
      return rows
    }

    // Favorites section (only when not searching)
    if (!searchValue && favoriteItems.length > 0) {
      rows.push({ type: 'fav-header' })
      for (const item of favoriteItems) {
        rows.push({ type: 'model-item', item, keyPrefix: 'fav' })
      }
      rows.push({ type: 'fav-divider' })
    }

    // Provider groups
    for (const [providerKey, models] of Object.entries(groupedItems)) {
      const providerInfo = providers.find((p) => p.provider === providerKey)
      if (!providerInfo) continue
      rows.push({ type: 'provider-header', providerKey, providerInfo })
      for (const item of models) {
        rows.push({ type: 'model-item', item })
      }
    }

    return rows
  }, [groupedItems, favoriteItems, searchValue, providers])

  const handleAutoToggle = useCallback(() => {
    if (activeThreadId) {
      setThreadOverride(activeThreadId, !isAutoActive)
    }
    setOpen(false)
  }, [activeThreadId, isAutoActive, setThreadOverride])

  const handleSelect = useCallback(
    async (searchableModel: SearchableModel) => {
      // Mark as user-initiated so provider refreshes don't revert the choice
      userSelectedRef.current = true

      // Disable auto-routing for this thread when user manually selects a model
      if (activeThreadId && isAutoActive) {
        setThreadOverride(activeThreadId, false)
      }

      // Immediately update display to prevent double-click issues
      setDisplayModel(getModelDisplayName(searchableModel.model))
      setSearchValue('')
      setOpen(false)

      selectModelProvider(
        searchableModel.provider.provider,
        searchableModel.model.id
      )
      updateCurrentThreadModel({
        id: searchableModel.model.id,
        provider: searchableModel.provider.provider,
      })

      // Store the selected model as last used
      setLastUsedModel(
        searchableModel.provider.provider,
        searchableModel.model.id
      )
    },
    [
      selectModelProvider,
      updateCurrentThreadModel,
      activeThreadId,
      isAutoActive,
      setThreadOverride,
    ]
  )

  // ── Render a single row ─────────────────────────────────────────────────
  const renderRow = useCallback((row: FlatRow) => {
    switch (row.type) {
      case 'fav-header':
        return (
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-muted-foreground/40 font-semibold">
            <Star className="size-2.5 fill-amber-500 text-amber-500" />
            {t('common:favorites')}
          </div>
        )

      case 'fav-divider':
        return <div className="h-px bg-border/50 mx-3 my-1.5" />

      case 'provider-header':
        return (
          <div className="flex items-center justify-between px-3 pt-2 pb-1">
            <div className="flex items-center gap-1.5">
              <div
                className="size-3 rounded-sm shrink-0"
                style={{ backgroundColor: getProviderColor(row.providerKey) }}
              />
              <span className="text-[10px] tracking-widest uppercase text-muted-foreground/40 font-semibold">
                {getProviderTitle(row.providerInfo.provider)}
              </span>
            </div>
            <button
              type="button"
              className="p-0.5 rounded hover:bg-muted text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                navigate({
                  to: route.settings.providers,
                  params: { providerName: row.providerInfo.provider },
                })
                setOpen(false)
              }}
            >
              <Settings className="size-3" />
            </button>
          </div>
        )

      case 'model-item':
        return (
          <ModelItem
            searchableModel={row.item}
            isSelected={
              selectedModel?.id === row.item.model.id &&
              selectedProvider === row.item.provider.provider
            }
            isFavorite={favoriteIdSet.has(row.item.model.id)}
            color={getProviderColor(row.item.provider.provider)}
            onSelect={handleSelect}
            onToggleFavorite={toggleFavorite}
          />
        )

      case 'empty-search':
        return (
          <div className="py-8 text-center">
            <CircleOff className="size-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-[13px] text-muted-foreground">
              {t('common:noModelsFoundFor', { searchValue: row.searchValue })}
            </p>
          </div>
        )
    }
  }, [selectedModel?.id, selectedProvider, favoriteIdSet, handleSelect, toggleFavorite, navigate, t])

  const currentModel = selectedModel?.id
    ? getModelBy(selectedModel?.id)
    : undefined

  if (!providers.length) return null

  const provider = getProviderByName(selectedProvider)

  const useVirtual = flatRows.length > VIRTUALIZE_THRESHOLD

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <div className="relative z-30 flex items-center gap-1">
          <button
            type="button"
            className="relative z-30 flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/60 transition-all group border border-transparent hover:border-border/50"
          >
            {/* Provider color indicator / Auto icon */}
            {isAutoActive ? (
              <div className="size-5 rounded-md shrink-0 bg-amber-500/20 flex items-center justify-center">
                <Route className="size-3 text-amber-600 dark:text-amber-400" />
              </div>
            ) : (
              <div
                className="size-5 rounded-md shrink-0"
                style={{ backgroundColor: getProviderColor(selectedProvider) }}
              />
            )}
            <span
              className={cn(
                'text-foreground/90 truncate max-w-[160px]',
                !selectedModel?.id && 'text-muted-foreground'
              )}
              style={{ fontSize: '13px', fontWeight: 500 }}
            >
              {displayModel}
            </span>
            <ChevronDown className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
          </button>
          {currentModel?.settings && provider && (
            <ModelSetting
              model={currentModel as Model}
              provider={provider}
            />
          )}
        </div>
      </PopoverTrigger>

      <PopoverContent
        className="w-[320px] p-0 rounded-xl overflow-hidden border-border/60 shadow-2xl"
        align="start"
        sideOffset={8}
        side="bottom"
      >
        <div className="flex flex-col">
          {/* Auto (LLM Router) option — only shown when there is an active thread to override */}
          {isRouterConfigured && activeThreadId && (
            <button
              type="button"
              className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 border-b border-border/50 transition-colors w-full text-left',
                isAutoActive
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              onClick={handleAutoToggle}
            >
              <div className={cn(
                'size-5 rounded-md shrink-0 flex items-center justify-center',
                isAutoActive ? 'bg-amber-500/20' : 'bg-muted'
              )}>
                <Route className="size-3" />
              </div>
              <span style={{ fontSize: '13px', fontWeight: 500 }} className="flex-1">
                Auto (LLM Router)
              </span>
              {isAutoActive && <Check className="size-3.5 text-amber-600 dark:text-amber-400 shrink-0" />}
            </button>
          )}
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
            <Search className="size-3.5 text-muted-foreground shrink-0" />
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t('common:searchModels')}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground/40"
              style={{ fontSize: '13px' }}
            />
            {searchValue && (
              <button
                type="button"
                onClick={onClearSearch}
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Model list — virtualized for large lists, plain for small */}
          {useVirtual ? (
            <VirtualizedList flatRows={flatRows} renderRow={renderRow} searchValue={searchValue} />
          ) : (
            <PlainList flatRows={flatRows} renderRow={renderRow} />
          )}

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border/50 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">
              {t('common:modelsCount', { count: searchableItems.length })}
            </span>
            <button
              type="button"
              className="text-[11px] text-primary/70 hover:text-primary transition-colors"
              onClick={() => {
                navigate({ to: route.settings.model_providers })
                setOpen(false)
              }}
            >
              {t('common:manageProviders')}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
})

export default DropdownModelProvider
