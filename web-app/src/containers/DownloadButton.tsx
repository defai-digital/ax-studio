import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useDownloadStore } from '@/hooks/models/useDownloadStore'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { cn, sanitizeModelId } from '@/lib/utils'
import { CatalogModel } from '@/services/models/types'
import { AppEvent, DownloadEvent, DownloadState, events } from '@ax-studio/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { ExternalLink, Download, Pause, Play } from 'lucide-react'

type ModelProps = {
  model: CatalogModel
  handleUseModel: (modelId: string) => void
}

export function DownloadButtonPlaceholder({
  model,
  handleUseModel,
}: ModelProps) {
  const { downloads, localDownloadingModels, addLocalDownloadingModel } =
    useDownloadStore(
      useShallow((state) => ({
        downloads: state.downloads,
        localDownloadingModels: state.localDownloadingModels,
        addLocalDownloadingModel: state.addLocalDownloadingModel,
      }))
    )
  const { t } = useTranslation()
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const llamaProvider = getProviderByName('llamacpp')

  const serviceHub = useServiceHub()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const [isDownloaded, setDownloaded] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)

  const quant =
    model.quants?.find((e) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((m) =>
        e.model_id.toLowerCase().includes(m)
      )
    ) ?? model.quants?.[0]

  const modelId = quant?.model_id || model.model_name

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

  useEffect(() => {
    const isDownloaded = llamaProvider?.models.some((m: { id: string }) => {
      const parts = modelId.split('/')
      const name = parts[parts.length - 1]
      const sanitizedName = sanitizeModelId(name)
      const author = parts.length > 1 ? parts.slice(0, -1).join('/') : ''

      return (
        m.id === modelId ||
        m.id === sanitizedName ||
        (author && m.id === `${author}/${sanitizedName}`) ||
        m.id === `${model.developer}/${sanitizedName}`
      )
    })
    setDownloaded(!!isDownloaded)
  }, [llamaProvider, modelId, model.developer])

  useEffect(() => {
    const handleVerified = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === modelId) setDownloaded(true)
    }
    // Also listen for onModelImported — onFileDownloadAndVerificationSuccess
    // only fires when SHA256 verification is enabled (skipVerification=false).
    // onModelImported fires unconditionally after model.yml is written.
    const handleImported = (payload: { modelId?: string }) => {
      if (payload?.modelId === modelId) setDownloaded(true)
    }
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      handleVerified
    )
    events.on(AppEvent.onModelImported, handleImported)
    return () => {
      events.off(
        DownloadEvent.onFileDownloadAndVerificationSuccess,
        handleVerified
      )
      events.off(AppEvent.onModelImported, handleImported)
    }
  }, [modelId])

  const isRecommendedModel = useCallback((_: string) => {
    return false
  }, [])

  if ((model.quants?.length ?? 0) === 0) {
    return (
      <a
        href={`https://huggingface.co/${model.model_name}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-accent text-foreground/70 hover:text-foreground text-[12px] font-medium transition-colors border border-border/50"
      >
        <ExternalLink className="size-3.5 shrink-0" />
        <span className="truncate">HuggingFace</span>
      </a>
    )
  }

  const modelUrl = quant?.path || modelId
  const isDownloading =
    localDownloadingModels.has(modelId) ||
    downloadProcesses.some((e) => e.id === modelId)

  const downloadProgress =
    downloadProcesses.find((e) => e.id === modelId)?.progress || 0

  const isRecommended = isRecommendedModel(model.model_name)

  const handleDownload = async () => {
    // Immediately set local downloading state and start download
    addLocalDownloadingModel(modelId)
    setIsPaused(false)
    const mmprojPath = (
      model.mmproj_models?.find(
        (e) => e.model_id.toLowerCase() === 'mmproj-f16'
      ) || model.mmproj_models?.[0]
    )?.path
    serviceHub
      .models()
      .pullModelWithMetadata(modelId, modelUrl, mmprojPath, huggingfaceToken)
  }

  const handlePause = async () => {
    try {
      await serviceHub.models().abortDownload(modelId)
      setIsPaused(true)
    } catch (error) {
      console.error('Failed to pause download:', error)
    }
  }

  const handleResume = () => {
    handleDownload()
  }

  return (
    <div
      className={cn(
        'flex items-center',
        isRecommended && 'hub-download-button-step'
      )}
    >
      {isDownloading && !isDownloaded && (
        <div className={cn('flex items-center gap-2')}>
          <Progress className="border w-20" value={downloadProgress * 100} />
          <span className="text-xs text-center text-muted-foreground min-w-[2rem]">
            {Math.round(downloadProgress * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={isPaused ? handleResume : handlePause}
            className="h-6 px-2"
          >
            {isPaused ? (
              <>
                <Play className="size-3 mr-1" />
                Resume
              </>
            ) : (
              <>
                <Pause className="size-3 mr-1" />
                Pause
              </>
            )}
          </Button>
        </div>
      )}
      {isDownloaded ? (
        <Button
          variant="default"
          size="sm"
          onClick={() => handleUseModel(modelId)}
          data-test-id={`hub-model-${modelId}`}
        >
          {t('hub:newChat')}
        </Button>
      ) : (
        <button
          data-test-id={`hub-model-${modelId}`}
          onClick={handleDownload}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-accent text-foreground/70 hover:text-foreground text-[12px] font-medium transition-colors border border-border/50',
            isDownloading && 'hidden'
          )}
        >
          <Download className="size-3.5" />
          {t('hub:download')}
        </button>
      )}
    </div>
  )
}
