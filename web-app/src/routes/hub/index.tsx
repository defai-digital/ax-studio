import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { cn } from '@/lib/utils'
import {
  useState,
  useMemo,
  useEffect,
  ChangeEvent,
  useCallback,
  useRef,
  useTransition,
} from 'react'
import { CardItem } from '@/containers/Card'
import { extractModelName, extractDescription } from '@/lib/models'
import { IconDownload, IconFileCode } from '@tabler/icons-react'
import { Switch } from '@/components/ui/switch'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel } from '@/services/models/types'
import HeaderPage from '@/containers/HeaderPage'
import {
  ChevronsUpDown,
  Eye,
  Loader,
  Wrench,
  Atom,
  HardDrive,
  Search,
  X,
  CheckCircle2,
  MessageCircle,
  RotateCcw,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import Fuse from 'fuse.js'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { DownloadButtonPlaceholder } from '@/containers/DownloadButton'
import { useShallow } from 'zustand/shallow'
import { ModelDownloadAction } from '@/containers/ModelDownloadAction'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { sanitizeModelId } from '@/lib/utils'

type FilterTag = 'all' | 'downloaded' | 'tools' | 'vision' | 'reasoning'

type SearchParams = {
  repo: string
}

export const Route = createFileRoute(route.hub.index)({
  component: HubContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function HubContent() {
  const [isPending, startTransition] = useTransition()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const serviceHub = useServiceHub()
  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  const { t } = useTranslation()

  const sortOptions = [
    { value: 'newest', name: t('hub:sortNewest') },
    { value: 'most-downloaded', name: t('hub:sortMostDownloaded') },
  ]
  const searchOptions = useMemo(
    () => ({
      includeScore: true,
      keys: ['model_name', 'quants.model_id'],
    }),
    []
  )

  const { sources, fetchSources, loading } = useModelSources(
    useShallow((state) => ({
      sources: state.sources,
      fetchSources: state.fetchSources,
      loading: state.loading,
    }))
  )

  const [searchValue, setSearchValue] = useState('')
  const [sortSelected, setSortSelected] = useState('newest')
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(
    {}
  )
  const [isSearching, setIsSearching] = useState(false)
  const [activeFilter, setActiveFilter] = useState<FilterTag>('all')
  const [huggingFaceRepo, setHuggingFaceRepo] = useState<CatalogModel | null>(
    null
  )
  const [modelSupportStatus, setModelSupportStatus] = useState<
    Record<string, 'RED' | 'YELLOW' | 'GREEN' | 'GREY' | 'LOADING'>
  >({})
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const addModelSourceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const filters: {
    id: FilterTag
    label: string
    icon?: React.ReactNode
  }[] = [
    { id: 'all', label: t('hub:allModels') || 'All Models' },
    {
      id: 'downloaded',
      label: t('hub:downloaded') || 'Downloaded',
      icon: <HardDrive className="size-3" />,
    },
    {
      id: 'tools',
      label: 'Tool Use',
      icon: <Wrench className="size-3" />,
    },
    { id: 'vision', label: 'Vision', icon: <Eye className="size-3" /> },
    {
      id: 'reasoning',
      label: 'Reasoning',
      icon: <Atom className="size-3" />,
    },
  ]

  const toggleModelExpansion = useCallback((modelId: string) => {
    setExpandedModels((prev) => ({
      ...prev,
      [modelId]: !prev[modelId],
    }))
  }, [])

  // Sorting functionality
  const sortedModels = useMemo(() => {
    const sorted = [...sources]
    if (sortSelected === 'most-downloaded') {
      return sorted.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    }
    return sorted.sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime()
    )
  }, [sortSelected, sources])

  // Filtered models (debounced search)
  const [debouncedSearchValue, setDebouncedSearchValue] = useState(searchValue)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchValue(searchValue)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchValue])

  // Helper to check if a model is downloaded
  const isModelDownloaded = useCallback(
    (model: CatalogModel) => {
      const llamaProvider = getProviderByName('llamacpp')
      return !!model.quants?.some((quant) =>
        llamaProvider?.models.some((m) => {
          const parts = quant.model_id.split('/')
          const name = parts.length > 1 ? parts[1] : parts[0]
          const sanitizedName = sanitizeModelId(name)
          const author = parts.length > 1 ? parts[0] : ''
          return (
            m.id === quant.model_id ||
            m.id === sanitizedName ||
            (author && m.id === `${author}/${sanitizedName}`) ||
            (model.developer && m.id === `${model.developer}/${sanitizedName}`)
          )
        })
      )
    },
    [getProviderByName]
  )

  const filteredModels = useMemo(() => {
    let filtered = sortedModels
    // Apply search filter
    if (debouncedSearchValue.length) {
      const fuse = new Fuse(filtered, searchOptions)
      const cleanedSearchValue = debouncedSearchValue.replace(
        /^https?:\/\/[^/]+\//,
        ''
      )
      filtered = fuse.search(cleanedSearchValue).map((result) => result.item)
    }
    // Apply filter tags
    if (activeFilter === 'downloaded') {
      filtered = filtered.filter((model) => isModelDownloaded(model))
    } else if (activeFilter === 'tools') {
      filtered = filtered.filter((model) => model.tools)
    } else if (activeFilter === 'vision') {
      filtered = filtered.filter((model) => (model.num_mmproj ?? 0) > 0)
    } else if (activeFilter === 'reasoning') {
      filtered = filtered.filter(
        (model) =>
          model.model_name.toLowerCase().includes('reason') ||
          model.model_name.toLowerCase().includes('-r1')
      )
    }
    if (huggingFaceRepo) {
      filtered = [huggingFaceRepo, ...filtered]
    }
    return filtered
  }, [
    sortedModels,
    debouncedSearchValue,
    activeFilter,
    huggingFaceRepo,
    searchOptions,
    isModelDownloaded,
  ])

  // Stats
  const stats = useMemo(() => {
    const downloaded = sources.filter((m) => isModelDownloaded(m)).length
    return { total: sources.length, downloaded }
  }, [sources, isModelDownloaded])

  useEffect(() => {
    startTransition(() => {
      fetchSources()
    })
  }, [fetchSources])

  // Reset initial load state after data loads or on filter change
  useEffect(() => {
    if (!isInitialLoad) return
    const timer = setTimeout(() => setIsInitialLoad(false), 150)
    return () => clearTimeout(timer)
  }, [isInitialLoad, filteredModels.length])

  const fetchHuggingFaceModel = async (searchValue: string) => {
    if (
      !searchValue.length ||
      (!searchValue.includes('/') && !searchValue.startsWith('http'))
    ) {
      return
    }

    setIsSearching(true)
    if (addModelSourceTimeoutRef.current) {
      clearTimeout(addModelSourceTimeoutRef.current)
    }

    addModelSourceTimeoutRef.current = setTimeout(async () => {
      try {
        const repoInfo = await serviceHub
          .models()
          .fetchHuggingFaceRepo(searchValue, huggingfaceToken)
        if (repoInfo) {
          const catalogModel = serviceHub
            .models()
            .convertHfRepoToCatalogModel(repoInfo)
          if (
            !sources.some(
              (s) =>
                catalogModel.model_name.trim().split('/').pop() ===
                  s.model_name.trim() &&
                catalogModel.developer?.trim() === s.developer?.trim()
            )
          ) {
            setHuggingFaceRepo(catalogModel)
          }
        }
      } catch (error) {
        console.error('Error fetching repository info:', error)
      } finally {
        setIsSearching(false)
      }
    }, 500)
  }

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setIsSearching(false)
    setSearchValue(e.target.value)
    setHuggingFaceRepo(null)

    if (activeFilter !== 'downloaded') {
      fetchHuggingFaceModel(e.target.value)
    }
  }

  const navigate = useNavigate()

  const isRecommendedModel = useCallback((_: string) => {
    return false
  }, [])

  const handleUseModel = useCallback(
    (modelId: string) => {
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: modelId,
            provider: 'llamacpp',
          },
        },
      })
    },
    [navigate]
  )

  const checkModelSupport = useCallback(
    async (variant: { model_id: string; path: string }) => {
      const modelKey = variant.model_id

      if (modelSupportStatus[modelKey]) {
        return
      }

      setModelSupportStatus((prev) => ({
        ...prev,
        [modelKey]: 'LOADING',
      }))

      try {
        const modelPath = variant.path
        const supportStatus = await serviceHub
          .models()
          .isModelSupported(modelPath, 8192)

        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: supportStatus,
        }))
      } catch (error) {
        console.error('Error checking model support:', error)
        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: 'RED',
        }))
      }
    },
    [modelSupportStatus, serviceHub]
  )

  const clearFilters = useCallback(() => {
    setSearchValue('')
    setActiveFilter('all')
    setHuggingFaceRepo(null)
    setIsInitialLoad(true)
  }, [])

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('hub:title') || 'Model Hub'}
          </span>
        </div>
      </HeaderPage>

      {/* Hub Header Section */}
      <div className="px-6 py-6 border-b border-border/40 shrink-0">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1
                className="text-foreground mb-1 tracking-tight"
                style={{ fontSize: '22px', fontWeight: 700 }}
              >
                {t('hub:title') || 'Model Hub'}
              </h1>
              <p className="text-muted-foreground" style={{ fontSize: '13px' }}>
                {t('hub:subtitle') ||
                  'Discover and download open-source AI models. Optimized for local inference.'}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[12px] text-muted-foreground shrink-0">
              <div className="flex items-center gap-1.5">
                <HardDrive className="size-3.5 text-indigo-500" />
                <span>
                  {stats.downloaded}/{stats.total} downloaded
                </span>
              </div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                {isSearching ? (
                  <Loader className="size-3.5 animate-spin text-muted-foreground/60" />
                ) : (
                  <Search className="size-3.5 text-muted-foreground/60" />
                )}
              </div>
              <input
                placeholder={
                  t('hub:searchPlaceholder') || 'Search models, developers...'
                }
                value={searchValue}
                onChange={handleSearchChange}
                className="w-full pl-9 pr-9 py-2 rounded-xl bg-muted/40 border border-border/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/10 outline-none transition-all text-[13px] placeholder:text-muted-foreground/50"
              />
              {searchValue && (
                <button
                  onClick={() => {
                    setSearchValue('')
                    setHuggingFaceRepo(null)
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {filters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setIsInitialLoad(true)
                    setActiveFilter(f.id)
                    if (f.id === 'downloaded') {
                      setHuggingFaceRepo(null)
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all text-[12px]',
                    activeFilter === f.id
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                      : 'bg-background text-muted-foreground border-border/50 hover:border-border hover:text-foreground hover:bg-muted/30'
                  )}
                >
                  {f.icon}
                  {f.label}
                </button>
              ))}

              {/* Sort dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg border-border/50 text-[12px] h-[30px] ml-1"
                  >
                    {
                      sortOptions.find(
                        (option) => option.value === sortSelected
                      )?.name
                    }
                    <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground ml-1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end">
                  {sortOptions.map((option) => (
                    <DropdownMenuItem
                      className={cn(
                        'cursor-pointer my-0.5',
                        sortSelected === option.value && 'bg-secondary'
                      )}
                      key={option.value}
                      onClick={() => {
                        setIsInitialLoad(true)
                        setSortSelected(option.value)
                      }}
                    >
                      {option.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Model Grid */}
      <div
        className="flex-1 overflow-y-auto px-6 py-5 first-step-setup-local-provider"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="max-w-5xl mx-auto">
          {isInitialLoad || (loading && !filteredModels.length) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col p-4 rounded-xl border border-border/50 bg-card"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="size-1.5 bg-muted rounded-full" />
                        <div className="h-4 bg-muted rounded-md w-28" />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-3 bg-muted rounded w-16" />
                        <div className="h-3 bg-muted rounded w-12" />
                      </div>
                    </div>
                    <div className="h-5 bg-muted rounded-lg w-14" />
                  </div>
                  <div className="h-3 bg-muted rounded w-full mb-1.5" />
                  <div className="h-3 bg-muted rounded w-3/4 mb-3" />
                  <div className="flex gap-1.5 mb-3">
                    <div className="h-5 bg-muted rounded-md w-14" />
                    <div className="h-5 bg-muted rounded-md w-12" />
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border/30">
                    <div className="h-3 bg-muted rounded w-24" />
                    <div className="h-7 bg-muted rounded-lg w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Search className="size-6 text-muted-foreground/40" />
              </div>
              <p className="text-[15px] font-medium text-foreground/70 mb-2">
                {t('hub:noModels') || 'No models found'}
              </p>
              <p className="text-[13px] text-muted-foreground mb-4">
                Try adjusting your search or filter criteria
              </p>
              {(searchValue || activeFilter !== 'all') && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted hover:bg-accent text-foreground/70 transition-colors text-[13px]"
                >
                  <RotateCcw className="size-3.5" />
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div
              className={cn(
                'transition-opacity duration-200',
                isPending ? 'opacity-70' : 'opacity-100'
              )}
            >
              {/* Mobile filter */}
              <div className="flex items-center gap-2 justify-end sm:hidden mb-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={activeFilter === 'downloaded'}
                    onCheckedChange={(checked) => {
                      setIsInitialLoad(true)
                      setActiveFilter(checked ? 'downloaded' : 'all')
                      if (checked) {
                        setHuggingFaceRepo(null)
                      } else {
                        fetchHuggingFaceModel(searchValue)
                      }
                    }}
                  />
                  <span className="text-xs text-foreground font-medium whitespace-nowrap">
                    {t('hub:downloaded')}
                  </span>
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key="grid"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                >
                  {filteredModels.map((model, i) => {
                    const defaultQuant =
                      model.quants?.find((m) =>
                        DEFAULT_MODEL_QUANTIZATIONS.some((e) =>
                          m.model_id.toLowerCase().includes(e)
                        )
                      ) ?? model.quants?.[0]

                    const downloaded = isModelDownloaded(model)

                    // Get compatibility status from the default quant
                    const compatStatus = defaultQuant
                      ? modelSupportStatus[defaultQuant.model_id]
                      : undefined
                    const compatDot =
                      compatStatus === 'GREEN'
                        ? 'bg-emerald-500'
                        : compatStatus === 'YELLOW'
                          ? 'bg-amber-500'
                          : compatStatus === 'RED'
                            ? 'bg-red-500'
                            : 'bg-muted-foreground/30'
                    const compatLabel =
                      compatStatus === 'GREEN'
                        ? 'Recommended'
                        : compatStatus === 'YELLOW'
                          ? 'Slower'
                          : compatStatus === 'RED'
                            ? 'Incompatible'
                            : undefined

                    return (
                      <motion.div
                        key={model.model_name}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.04, 0.4) }}
                        className="flex flex-col p-4 rounded-xl border border-border/50 bg-card hover:border-border hover:shadow-md transition-all group cursor-pointer"
                        onClick={() => {
                          navigate({
                            to: route.hub.model,
                            params: {
                              modelId: model.model_name,
                            },
                          })
                        }}
                      >
                        {/* Card Header */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <div
                                className={`size-1.5 rounded-full shrink-0 ${compatDot}`}
                              />
                              <h3
                                className={cn(
                                  'font-semibold text-foreground group-hover:text-primary transition-colors truncate capitalize',
                                  isRecommendedModel(model.model_name)
                                    ? 'hub-model-card-step'
                                    : ''
                                )}
                                style={{ fontSize: '14px' }}
                                title={extractModelName(model.model_name) || ''}
                              >
                                {extractModelName(model.model_name) || ''}
                              </h3>
                            </div>
                            <div className="flex items-center gap-2">
                              <p className="text-[12px] text-muted-foreground">
                                {model.developer}
                              </p>
                              {!defaultQuant?.file_size && (
                                <span className="text-[10px] text-muted-foreground/40">
                                  GGUF
                                </span>
                              )}
                            </div>
                          </div>
                          {defaultQuant?.file_size && (
                            <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                              <span className="text-[11px] px-2 py-0.5 rounded-lg bg-muted font-medium text-muted-foreground">
                                {defaultQuant.file_size}
                              </span>
                              <span className="text-[10px] text-muted-foreground/40">
                                GGUF
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Description */}
                        <div className="text-[12px] text-muted-foreground leading-relaxed mb-3 line-clamp-2 flex-1">
                          <RenderMarkdown
                            className="select-none reset-heading"
                            components={{
                              a: ({ ...props }) => (
                                <a
                                  {...props}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ),
                            }}
                            content={
                              extractDescription(model.description) || ''
                            }
                          />
                        </div>

                        {/* Capability Tags */}
                        {((model.num_mmproj ?? 0) > 0 ||
                          model.tools ||
                          compatLabel) && (
                          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                            {(model.num_mmproj ?? 0) > 0 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[11px] font-medium">
                                <Eye className="size-2.5" /> Vision
                              </span>
                            )}
                            {model.tools && (
                              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] font-medium">
                                <Wrench className="size-2.5" /> Tools
                              </span>
                            )}
                            {compatLabel && (
                              <span
                                className={cn(
                                  'ml-auto text-[10px] font-medium',
                                  compatStatus === 'GREEN' &&
                                    'text-emerald-500',
                                  compatStatus === 'YELLOW' && 'text-amber-500',
                                  compatStatus === 'RED' && 'text-red-500'
                                )}
                              >
                                {compatLabel}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Footer */}
                        <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/40 mt-auto">
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/50 min-w-0 overflow-hidden">
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <IconDownload size={12} className="shrink-0" />
                              {model.downloads
                                ? `${(model.downloads / 1000).toFixed(0)}k`
                                : '0'}
                            </span>
                            <span className="text-muted-foreground/20">
                              &middot;
                            </span>
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <IconFileCode size={12} className="shrink-0" />
                              {model.quants?.length || 0}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-2 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {downloaded ? (
                              <div className="flex items-center gap-1.5">
                                <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                                  <CheckCircle2 className="size-3.5" />
                                  Ready
                                </span>
                                <button
                                  onClick={() => {
                                    if (defaultQuant) {
                                      handleUseModel(defaultQuant.model_id)
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[12px] font-medium shadow-sm transition-all hover:shadow-md"
                                  style={{
                                    background:
                                      'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    boxShadow:
                                      '0 2px 6px rgba(99,102,241,0.25)',
                                  }}
                                >
                                  <MessageCircle className="size-3.5" />
                                  Chat
                                </button>
                              </div>
                            ) : (
                              <>
                                <ModelInfoHoverCard
                                  model={model}
                                  defaultModelQuantizations={
                                    DEFAULT_MODEL_QUANTIZATIONS
                                  }
                                  variant={defaultQuant}
                                  isDefaultVariant={true}
                                  modelSupportStatus={modelSupportStatus}
                                  onCheckModelSupport={checkModelSupport}
                                />
                                <DownloadButtonPlaceholder
                                  model={model}
                                  handleUseModel={handleUseModel}
                                />
                              </>
                            )}
                          </div>
                        </div>

                        {/* Show Variants Toggle */}
                        {(model.quants?.length ?? 0) > 1 && (
                          <div
                            className="flex items-center gap-2 mt-3 hub-show-variants-step"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Switch
                              checked={!!expandedModels[model.model_name]}
                              onCheckedChange={() =>
                                toggleModelExpansion(model.model_name)
                              }
                            />
                            <p className="text-muted-foreground text-[12px]">
                              {t('hub:showVariants')}
                            </p>
                          </div>
                        )}

                        {/* Expanded Variants */}
                        {expandedModels[model.model_name] &&
                          (model.quants?.length ?? 0) > 0 && (
                            <div
                              className="mt-3 border-t border-border/30 pt-3"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {model.quants?.map((variant) => (
                                <CardItem
                                  key={variant.model_id}
                                  title={
                                    <div className="flex items-center gap-1.5">
                                      <span className="mr-2 text-[13px]">
                                        {variant.model_id}
                                      </span>
                                      {(model.num_mmproj ?? 0) > 0 && (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400">
                                          <Eye className="size-2.5" />
                                        </span>
                                      )}
                                      {model.tools && (
                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                          <Wrench className="size-2.5" />
                                        </span>
                                      )}
                                    </div>
                                  }
                                  actions={
                                    <div className="flex items-center gap-2">
                                      <p className="text-muted-foreground font-medium text-[11px]">
                                        {variant.file_size}
                                      </p>
                                      <ModelInfoHoverCard
                                        model={model}
                                        variant={variant}
                                        defaultModelQuantizations={
                                          DEFAULT_MODEL_QUANTIZATIONS
                                        }
                                        modelSupportStatus={modelSupportStatus}
                                        onCheckModelSupport={checkModelSupport}
                                      />
                                      <ModelDownloadAction
                                        variant={variant}
                                        model={model}
                                      />
                                    </div>
                                  }
                                />
                              ))}
                            </div>
                          )}
                      </motion.div>
                    )
                  })}
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
