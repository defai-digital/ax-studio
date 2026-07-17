import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  toDownloadProcesses,
  useDownloadStore,
} from '@/hooks/models/useDownloadStore'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { getHuggingFaceModelUrl } from '@/lib/huggingface'
import { extractErrorMessage } from '@/lib/utils/error'
import { CatalogModel } from '@/services/models/types'
import { AppEvent, DownloadEvent, DownloadState, events } from '@ax-studio/core'
import { toast } from 'sonner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { DEFAULT_MODEL_QUANTIZATIONS } from '@/constants/models'
import { ExternalLink, Download, Pause, Play, Loader2 } from 'lucide-react'
import { findDownloadedLocalModel } from '@/lib/models/downloaded'
import { getPreferredMmprojPath } from '@/lib/models'
import { isMlxSupported } from '@/lib/platform/utils'

const DOWNLOAD_START_TIMEOUT_MS = 60_000
const DOWNLOAD_PROGRESS_TIMEOUT_MS = 120_000

type ModelProps = {
  model: CatalogModel
  handleUseModel: (modelId: string, provider?: string) => void
}

export function DownloadButtonPlaceholder({
  model,
  handleUseModel,
}: ModelProps) {
  const {
    downloads,
    localDownloadingModels,
    addLocalDownloadingModel,
    removeDownload,
    removeLocalDownloadingModel,
  } = useDownloadStore(
    useShallow((state) => ({
      downloads: state.downloads,
      localDownloadingModels: state.localDownloadingModels,
      addLocalDownloadingModel: state.addLocalDownloadingModel,
      removeDownload: state.removeDownload,
      removeLocalDownloadingModel: state.removeLocalDownloadingModel,
    }))
  )
  const { t } = useTranslation()
  const providers = useModelProvider((state) => state.providers)

  const serviceHub = useServiceHub()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const [isDownloaded, setDownloaded] = useState<boolean>(false)
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [isStarting, setStarting] = useState<boolean>(false)
  const isStartingRef = useRef(false)
  const hasRealProgressRef = useRef(false)
  const mountedRef = useRef(true)
  const downloadTimersRef = useRef<Set<number>>(new Set())

  const setStartingState = useCallback((value: boolean) => {
    isStartingRef.current = value
    if (mountedRef.current) {
      setStarting(value)
    }
  }, [])

  const clearDownloadTimer = useCallback(
    (timer: number) => {
      window.clearTimeout(timer)
      downloadTimersRef.current.delete(timer)
    },
    []
  )

  useEffect(() => {
    mountedRef.current = true
    const downloadTimers = downloadTimersRef.current

    return () => {
      mountedRef.current = false
      downloadTimers.forEach((timer) => window.clearTimeout(timer))
      downloadTimers.clear()
    }
  }, [])

  const quant =
    model.quants?.find((e) =>
      DEFAULT_MODEL_QUANTIZATIONS.some((m) =>
        e.model_id.toLowerCase().includes(m)
      )
    ) ?? model.quants?.[0]

  const modelId = quant?.model_id || model.model_name

  const downloadProcesses = useMemo(
    () => toDownloadProcesses(downloads),
    [downloads]
  )

  const downloadedModel = useMemo(
    () => findDownloadedLocalModel(providers, modelId, model.developer),
    [providers, modelId, model.developer]
  )

  useEffect(() => {
    setDownloaded(!!downloadedModel)
  }, [downloadedModel])

  useEffect(() => {
    const handleVerified = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === modelId) {
        hasRealProgressRef.current = true
        setStartingState(false)
        removeLocalDownloadingModel(modelId)
        setDownloaded(true)
      }
    }
    const handleFinished = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === modelId) {
        hasRealProgressRef.current = true
        setStartingState(false)
        removeLocalDownloadingModel(modelId)
      }
    }
    const handleProgress = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === modelId) {
        const transferred = state.size?.transferred ?? 0
        const total = state.size?.total ?? 0
        if ((state.percent ?? 0) > 0 || transferred > 0 || total > 0) {
          hasRealProgressRef.current = true
        }
        setStartingState(false)
      }
    }
    const handleStarted = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === modelId) setStartingState(false)
    }
    // Also listen for onModelImported — onFileDownloadAndVerificationSuccess
    // only fires when SHA256 verification is enabled (skipVerification=false).
    // onModelImported fires unconditionally after model.yml is written.
    const handleImported = (payload: { modelId?: string }) => {
      if (payload?.modelId === modelId) {
        setStartingState(false)
        removeLocalDownloadingModel(modelId)
        setDownloaded(true)
      }
    }
    events.on(DownloadEvent.onFileDownloadUpdate, handleProgress)
    events.on(DownloadEvent.onFileDownloadStarted, handleStarted)
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      handleVerified
    )
    events.on(DownloadEvent.onFileDownloadSuccess, handleFinished)
    events.on(DownloadEvent.onFileDownloadError, handleFinished)
    events.on(DownloadEvent.onFileDownloadStopped, handleFinished)
    events.on(AppEvent.onModelImported, handleImported)
    return () => {
      events.off(DownloadEvent.onFileDownloadUpdate, handleProgress)
      events.off(DownloadEvent.onFileDownloadStarted, handleStarted)
      events.off(
        DownloadEvent.onFileDownloadAndVerificationSuccess,
        handleVerified
      )
      events.off(DownloadEvent.onFileDownloadSuccess, handleFinished)
      events.off(DownloadEvent.onFileDownloadError, handleFinished)
      events.off(DownloadEvent.onFileDownloadStopped, handleFinished)
      events.off(AppEvent.onModelImported, handleImported)
    }
  }, [modelId, removeDownload, removeLocalDownloadingModel, setStartingState])

  if ((model.quants?.length ?? 0) === 0) {
    return (
      <a
        href={getHuggingFaceModelUrl(model.model_name)}
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

  const handleDownload = async () => {
    // Check if this is an MLX model and if MLX is supported on this platform
    const isMlxModel = modelUrl.startsWith('hf://') || model?.is_mlx
    if (isMlxModel && !isMlxSupported()) {
      toast.error('MLX models not supported', {
        description:
          'MLX models only work on macOS with Apple Silicon (M1/M2/M3/M4). Please download a GGUF version instead.',
      })
      return
    }
    hasRealProgressRef.current = false
    addLocalDownloadingModel(modelId)
    setStartingState(true)
    setIsPaused(false)
    const mmprojPath = getPreferredMmprojPath(model.mmproj_models)
    const progressTimeout = window.setTimeout(() => {
      downloadTimersRef.current.delete(progressTimeout)
      if (hasRealProgressRef.current) return
      setStartingState(false)
      removeLocalDownloadingModel(modelId)
      removeDownload(modelId)
      serviceHub
        .models()
        .abortDownload(modelId)
        .catch((error) => {
          console.error('Failed to abort stalled model download:', error)
        })
    }, DOWNLOAD_PROGRESS_TIMEOUT_MS)
    downloadTimersRef.current.add(progressTimeout)
    const startTimeout = window.setTimeout(() => {
      downloadTimersRef.current.delete(startTimeout)
      if (!isStartingRef.current) return
      clearDownloadTimer(progressTimeout)
      setStartingState(false)
      removeLocalDownloadingModel(modelId)
      toast.error('Download did not start', {
        description:
          'This model is not available for AX Studio in-app download yet. Open it on Hugging Face or choose a GGUF/Ax-ready model.',
      })
      serviceHub
        .models()
        .abortDownload(modelId)
        .catch((error) => {
          console.error('Failed to abort stalled model download:', error)
        })
    }, DOWNLOAD_START_TIMEOUT_MS)
    downloadTimersRef.current.add(startTimeout)
    serviceHub
      .models()
      .pullModelWithMetadata(modelId, modelUrl, mmprojPath, huggingfaceToken)
      .catch((error) => {
        console.error('Failed to start model download:', error)
        const description = extractErrorMessage(error, '')
        toast.error('Failed to start model download', {
          description: description || 'Unknown error (check DevTools console).',
        })
      })
      .finally(() => {
        clearDownloadTimer(startTimeout)
        clearDownloadTimer(progressTimeout)
        setStartingState(false)
        removeLocalDownloadingModel(modelId)
      })
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
    <div className="flex items-center">
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
          onClick={() =>
            handleUseModel(
              downloadedModel?.modelId ?? modelId,
              downloadedModel?.providerId
            )
          }
          data-test-id={`hub-model-${modelId}`}
        >
          {t('hub:newChat')}
        </Button>
      ) : (
        <button
          data-test-id={`hub-model-${modelId}`}
          onClick={handleDownload}
          disabled={isStarting}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-accent text-foreground/70 hover:text-foreground text-[12px] font-medium transition-colors border border-border/50',
            isDownloading && 'hidden',
            isStarting && 'cursor-wait opacity-80'
          )}
        >
          {isStarting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          {t('hub:download')}
        </button>
      )}
    </div>
  )
}
