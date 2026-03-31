import HeaderPage from '@/containers/HeaderPage'
import {
  createFileRoute,
  useParams,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { IconArrowLeft } from '@tabler/icons-react'
import {
  Eye,
  Wrench,
  Calendar,
  Download,
  ExternalLink,
  HardDrive,
} from 'lucide-react'
import { motion } from 'motion/react'
import { route } from '@/constants/routes'
import { useModelSources } from '@/hooks/useModelSources'
import { extractModelName, extractDescription } from '@/lib/models'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useEffect, useMemo, useCallback, useState } from 'react'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { CatalogModel, ModelQuant } from '@/services/models/types'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { sanitizeModelId } from '@/lib/utils'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { ModelInfoHoverCard } from '@/containers/ModelInfoHoverCard'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { useTranslation } from '@/i18n'

type SearchParams = {
  repo: string
}

export const Route = createFileRoute('/hub/$modelId')({
  component: HubModelDetailContent,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    repo: search.repo as SearchParams['repo'],
  }),
})

function HubModelDetailContent() {
  const { t } = useTranslation()
  const { modelId: rawModelId } = useParams({ from: Route.id })
  const modelId = sanitizeModelId(rawModelId)
  const navigate = useNavigate()
  const { huggingfaceToken } = useGeneralSetting()
  const { sources, fetchSources } = useModelSources()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useSearch({ from: Route.id as any })

  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const llamaProvider = getProviderByName('llamacpp')
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore()
  const serviceHub = useServiceHub()
  const [repoData, setRepoData] = useState<CatalogModel | undefined>()

  // State for README content
  const [readmeContent, setReadmeContent] = useState<string>('')
  const [isLoadingReadme, setIsLoadingReadme] = useState(false)

  // State for model support status
  const [modelSupportStatus, setModelSupportStatus] = useState<
    Record<string, 'RED' | 'YELLOW' | 'GREEN' | 'LOADING' | 'GREY'>
  >({})

  useEffect(() => {
    fetchSources()
  }, [fetchSources])

  const fetchRepo = useCallback(async () => {
    const repoInfo = await serviceHub
      .models()
      .fetchHuggingFaceRepo(search.repo || modelId, huggingfaceToken)
    if (repoInfo) {
      const repoDetail = serviceHub
        .models()
        .convertHfRepoToCatalogModel(repoInfo)
      setRepoData(repoDetail || undefined)
    }
  }, [serviceHub, modelId, search, huggingfaceToken])

  useEffect(() => {
    fetchRepo()
  }, [modelId, fetchRepo])
  // Find the model data from sources
  const modelData = useMemo(() => {
    return sources.find((model) => model.model_name === modelId) ?? repoData
  }, [sources, modelId, repoData])

  // Download processes
  const downloadProcesses = useMemo(
    () =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      })),
    [downloads]
  )

  // Handle model use
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

  // Format the date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays < 7) {
      return `${diffDays} days ago`
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7)
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30)
      return `${months} month${months > 1 ? 's' : ''} ago`
    } else {
      const years = Math.floor(diffDays / 365)
      return `${years} year${years > 1 ? 's' : ''} ago`
    }
  }

  // Check model support function
  const checkModelSupport = useCallback(
    async (variant: ModelQuant) => {
      const modelKey = variant.model_id

      // Don't check again if already checking or checked
      if (modelSupportStatus[modelKey]) {
        return
      }

      // Set loading state
      setModelSupportStatus((prev) => ({
        ...prev,
        [modelKey]: 'LOADING',
      }))

      try {
        // Use the HuggingFace path for the model
        const modelPath = variant.path
        const supported = await serviceHub
          .models()
          .isModelSupported(modelPath, 8192)
        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: supported,
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

  // Extract tags from quants (model variants)
  const tags = useMemo(() => {
    if (!modelData?.quants) return []
    // Extract unique size indicators from quant names
    const sizePattern = /(\d+b)/i
    const uniqueSizes = new Set<string>()

    modelData.quants.forEach((quant) => {
      const match = quant.model_id.match(sizePattern)
      if (match) {
        uniqueSizes.add(match[1].toLowerCase())
      }
    })

    return Array.from(uniqueSizes).sort((a, b) => {
      const numA = parseInt(a)
      const numB = parseInt(b)
      return numA - numB
    })
  }, [modelData])

  // Fetch README content when modelData.readme is available
  useEffect(() => {
    if (modelData?.readme) {
      setIsLoadingReadme(true)
      // Try fetching without headers first
      // There is a weird issue where this HF link will return error when access public repo with auth header
      fetch(modelData.readme)
        .then((response) => {
          if (!response.ok && huggingfaceToken && modelData?.readme) {
            // Retry with Authorization header if first fetch failed
            return fetch(modelData.readme, {
              headers: {
                Authorization: `Bearer ${huggingfaceToken}`,
              },
            })
          }
          return response
        })
        .then((response) => response.text())
        .then((content) => {
          setReadmeContent(content)
          setIsLoadingReadme(false)
        })
        .catch((error) => {
          console.error('Failed to fetch README:', error)
          setIsLoadingReadme(false)
        })
    }
  }, [modelData?.readme, huggingfaceToken])

  if (!modelData) {
    return (
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <button
            onClick={() => navigate({ to: route.hub.index })}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            style={{ fontSize: '13px' }}
          >
            <IconArrowLeft size={16} />
            Back to Hub
          </button>
        </HeaderPage>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[14px] text-muted-foreground">Model not found</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      {/* Back Button */}
      <HeaderPage>
        <button
          onClick={() => navigate({ to: route.hub.index })}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          style={{ fontSize: '13px' }}
        >
          <IconArrowLeft size={16} />
          Back to Hub
        </button>
      </HeaderPage>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto px-6 py-6"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="max-w-4xl mx-auto">
          {/* Model Header */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h1
                  className="mb-2 capitalize wrap-break-word line-clamp-2"
                  style={{ fontSize: '24px', fontWeight: 600 }}
                  title={
                    extractModelName(modelData.model_name) ||
                    modelData.model_name
                  }
                >
                  {extractModelName(modelData.model_name) ||
                    modelData.model_name}
                </h1>

                {/* Stats line */}
                <div className="flex items-center gap-3 text-[13px] text-muted-foreground mb-3">
                  {modelData.developer && (
                    <>
                      <span>by {modelData.developer}</span>
                      <span className="text-muted-foreground/30">&middot;</span>
                    </>
                  )}
                  <span className="flex items-center gap-1">
                    <Download className="size-3" />
                    {modelData.downloads || 0} Downloads
                  </span>
                  {modelData.created_at && (
                    <>
                      <span className="text-muted-foreground/30">&middot;</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        Updated {formatDate(modelData.created_at)}
                      </span>
                    </>
                  )}
                </div>

                {/* Description */}
                {modelData.description && (
                  <div className="text-[14px] text-muted-foreground/80 max-w-2xl mb-3">
                    <RenderMarkdown
                      className="select-none reset-heading"
                      components={{
                        a: ({ ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                      }}
                      content={
                        extractDescription(modelData.description) ||
                        modelData.description
                      }
                    />
                  </div>
                )}

                {/* Tags & Capability Badges */}
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-0.5 rounded-md bg-muted text-[12px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                  {modelData.mmproj_models &&
                    modelData.mmproj_models.length > 0 && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[11px]">
                        <Eye className="size-3" /> Vision
                      </span>
                    )}
                  {modelData.tools && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px]">
                      <Wrench className="size-3" /> Tools
                    </span>
                  )}
                </div>
              </div>

              {/* HuggingFace link */}
              <a
                href={`https://huggingface.co/${modelData.model_name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border/50 hover:border-border text-[13px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <ExternalLink className="size-3.5" />
                View on HuggingFace
              </a>
            </div>
          </motion.div>

          {/* Variants Section */}
          {modelData.quants && modelData.quants.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mb-8"
            >
              <h2
                style={{ fontSize: '16px', fontWeight: 600 }}
                className="mb-3"
              >
                Available Variants ({modelData.quants.length})
              </h2>

              <div className="rounded-2xl border border-border/50 overflow-hidden shadow-sm">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_100px_100px_60px_140px] px-5 py-2.5 bg-muted/30 border-b border-border/30 text-[11px] tracking-wider uppercase text-muted-foreground/60">
                  <span>Version</span>
                  <span>Format</span>
                  <span>Size</span>
                  <span>Info</span>
                  <span className="text-right">Action</span>
                </div>

                {/* Data rows */}
                {modelData.quants.map((variant) => {
                  const isDownloading =
                    localDownloadingModels.has(variant.model_id) ||
                    downloadProcesses.some((e) => e.id === variant.model_id)
                  const downloadProgress =
                    downloadProcesses.find((e) => e.id === variant.model_id)
                      ?.progress || 0
                  // Check if model is already downloaded by looking
                  // at the llamacpp provider's installed models list
                  const isDownloaded = !!llamaProvider?.models.some(
                    (m: { id: string }) =>
                      m.id === variant.model_id ||
                      m.id ===
                        `${modelData.developer}/${sanitizeModelId(variant.model_id.split('/').pop() || '')}`
                  )

                  // Extract format from model_id
                  const format = variant.model_id
                    .toLowerCase()
                    .includes('tensorrt')
                    ? 'TensorRT'
                    : 'GGUF'

                  // Extract version name (remove format suffix)
                  const versionName = variant.model_id
                    .replace(/_GGUF$/i, '')
                    .replace(/-GGUF$/i, '')
                    .replace(/_TensorRT$/i, '')
                    .replace(/-TensorRT$/i, '')

                  return (
                    <div
                      key={variant.model_id}
                      className="grid grid-cols-[1fr_100px_100px_60px_140px] items-center px-5 py-3 border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors"
                    >
                      <span className="text-[14px]" style={{ fontWeight: 500 }}>
                        {versionName}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        <span className="px-2 py-0.5 rounded bg-muted">
                          {format}
                        </span>
                      </span>
                      <span className="text-[13px] text-muted-foreground flex items-center gap-1">
                        <HardDrive className="size-3" />
                        {variant.file_size}
                      </span>
                      <span>
                        <ModelInfoHoverCard
                          model={modelData}
                          variant={variant}
                          defaultModelQuantizations={
                            DEFAULT_MODEL_QUANTIZATIONS
                          }
                          modelSupportStatus={modelSupportStatus}
                          onCheckModelSupport={checkModelSupport}
                        />
                      </span>
                      <div className="flex justify-end">
                        {(() => {
                          if (isDownloading && !isDownloaded) {
                            return (
                              <div className="flex items-center justify-end gap-2">
                                <Progress
                                  value={downloadProgress * 100}
                                  className="w-16 h-1.5"
                                />
                                <span className="text-[11px] text-muted-foreground text-right">
                                  {Math.round(downloadProgress * 100)}%
                                </span>
                              </div>
                            )
                          }

                          if (isDownloaded) {
                            return (
                              <Button
                                variant="default"
                                size="sm"
                                className="rounded-lg"
                                onClick={() => handleUseModel(variant.model_id)}
                              >
                                {t('hub:newChat')}
                              </Button>
                            )
                          }

                          return (
                            <Button
                              size="sm"
                              className="rounded-lg"
                              onClick={() => {
                                addLocalDownloadingModel(variant.model_id)
                                serviceHub
                                  .models()
                                  .pullModelWithMetadata(
                                    variant.model_id,
                                    variant.path,
                                    (
                                      modelData.mmproj_models?.find(
                                        (e) =>
                                          e.model_id.toLowerCase() ===
                                          'mmproj-f16'
                                      ) || modelData.mmproj_models?.[0]
                                    )?.path,
                                    huggingfaceToken
                                  )
                              }}
                              variant="outline"
                            >
                              <Download className="size-3.5 mr-1.5" />
                              Download
                            </Button>
                          )
                        })()}
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {/* README Section */}
          {modelData.readme && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-8"
            >
              <h2
                style={{ fontSize: '16px', fontWeight: 600 }}
                className="mb-3"
              >
                README
              </h2>

              <div className="rounded-xl border border-border/50 p-6 bg-card">
                {isLoadingReadme ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-[13px] text-muted-foreground">
                      Loading README...
                    </span>
                  </div>
                ) : readmeContent ? (
                  <div className="prose-sm max-w-none">
                    <RenderMarkdown
                      className="text-muted-foreground"
                      components={{
                        a: ({ ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                      }}
                      content={readmeContent}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-[13px] text-muted-foreground">
                      Failed to load README
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
