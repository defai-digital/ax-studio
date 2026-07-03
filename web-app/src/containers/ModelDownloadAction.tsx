import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { route } from '@/constants/routes'
import {
  toDownloadProcesses,
  useDownloadStore,
} from '@/hooks/models/useDownloadStore'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useTranslation } from '@/i18n'
import { CatalogModel } from '@/services/models/types'
import { sanitizeModelId } from '@/lib/utils'
import { extractErrorMessage } from '@/lib/utils/error'
import { AppEvent, DownloadEvent, DownloadState, events } from '@ax-studio/core'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { findDownloadedLocalModel } from '@/lib/models/downloaded'
import { getPreferredMmprojPath } from '@/lib/models'

const DOWNLOAD_START_TIMEOUT_MS = 60_000
const DOWNLOAD_PROGRESS_TIMEOUT_MS = 120_000

export const ModelDownloadAction = ({
  variant,
  model,
}: {
  variant: { model_id: string; path: string }
  model: CatalogModel
}) => {
  const serviceHub = useServiceHub()

  const { t } = useTranslation()
  const huggingfaceToken = useGeneralSetting((state) => state.huggingfaceToken)
  const providers = useModelProvider((state) => state.providers)
  const {
    downloads,
    localDownloadingModels,
    addLocalDownloadingModel,
    removeDownload,
    removeLocalDownloadingModel,
  } =
    useDownloadStore()
  const [isDownloaded, setDownloaded] = useState<boolean>(false)
  const [isStarting, setStarting] = useState<boolean>(false)
  const isStartingRef = useRef(false)
  const hasRealProgressRef = useRef(false)

  const setStartingState = useCallback((value: boolean) => {
    isStartingRef.current = value
    setStarting(value)
  }, [])

  const downloadProcesses = useMemo(
    () => toDownloadProcesses(downloads),
    [downloads]
  )

  const navigate = useNavigate()

  const downloadedModel = useMemo(
    () => findDownloadedLocalModel(providers, variant.model_id, model.developer),
    [providers, variant.model_id, model.developer]
  )

  useEffect(() => {
    setDownloaded(!!downloadedModel)
  }, [downloadedModel])

  useEffect(() => {
    const sid = sanitizeModelId(variant.model_id.split('/').pop() || variant.model_id)
    const removeDownloadingAliases = () => {
      removeLocalDownloadingModel(variant.model_id)
      removeLocalDownloadingModel(sid)
    }
    const handleVerified = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === variant.model_id || downloadId === sid) {
        hasRealProgressRef.current = true
        removeDownloadingAliases()
        setStartingState(false)
        setDownloaded(true)
      }
    }
    const handleFinished = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === variant.model_id || downloadId === sid) {
        hasRealProgressRef.current = true
        removeDownloadingAliases()
        setStartingState(false)
      }
    }
    const handleProgress = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === variant.model_id || downloadId === sid) {
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
      if (downloadId === variant.model_id || downloadId === sid) {
        setStartingState(false)
      }
    }
    // Also listen for onModelImported — onFileDownloadAndVerificationSuccess
    // only fires when SHA256 verification is enabled (skipVerification=false).
    // onModelImported fires unconditionally after model.yml is written.
    const handleImported = (payload: { modelId?: string }) => {
      if (payload?.modelId === variant.model_id || payload?.modelId === sid) {
        removeDownloadingAliases()
        setStartingState(false)
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
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, handleVerified)
      events.off(DownloadEvent.onFileDownloadSuccess, handleFinished)
      events.off(DownloadEvent.onFileDownloadError, handleFinished)
      events.off(DownloadEvent.onFileDownloadStopped, handleFinished)
      events.off(AppEvent.onModelImported, handleImported)
    }
  }, [removeLocalDownloadingModel, setStartingState, variant.model_id])

  const handleUseModel = useCallback(
    (modelId: string, provider = 'llamacpp') => {
      navigate({
        to: route.home,
        params: {},
        search: {
          model: {
            id: modelId,
            provider,
          },
        },
      })
    },
    [navigate]
  )

  const handleDownloadModel = useCallback(async () => {
    hasRealProgressRef.current = false
    const isHfRepoImport = variant.path.startsWith('hf://')
    // GGUF variants use filename-like IDs; MLX repo imports must keep the
    // full Hugging Face repo id so ax-engine can resolve the downloaded folder.
    const baseModelId = variant.model_id.split('/').pop() || variant.model_id
    const downloadModelId = isHfRepoImport
      ? variant.model_id
      : sanitizeModelId(baseModelId)
    addLocalDownloadingModel(variant.model_id)
    addLocalDownloadingModel(downloadModelId)
    setStartingState(true)
    const startTimeout = window.setTimeout(() => {
      if (!isStartingRef.current) return
      setStartingState(false)
      removeLocalDownloadingModel(downloadModelId)
      removeLocalDownloadingModel(variant.model_id)
      toast.error('Download did not start', {
        description:
          'This model is not available for Ax Studio in-app download yet. Open it on Hugging Face or choose a GGUF/Ax-ready model.',
      })
      serviceHub.models().abortDownload(downloadModelId).catch(() => {})
    }, DOWNLOAD_START_TIMEOUT_MS)
    const progressTimeout = window.setTimeout(() => {
      if (hasRealProgressRef.current) return
      setStartingState(false)
      removeLocalDownloadingModel(downloadModelId)
      removeLocalDownloadingModel(variant.model_id)
      removeDownload(downloadModelId)
      removeDownload(variant.model_id)
      serviceHub.models().abortDownload(downloadModelId).catch(() => {})
    }, DOWNLOAD_PROGRESS_TIMEOUT_MS)
    // Mark download as started before the async call to prevent
    // timeouts from cancelling MLX downloads that need extra time
    // for HuggingFace metadata and manifest generation checks.
    hasRealProgressRef.current = true
    serviceHub
      .models()
      .pullModelWithMetadata(
        downloadModelId,
        variant.path,
        getPreferredMmprojPath(model.mmproj_models),
        huggingfaceToken
      )
      .catch((error) => {
        console.error('Failed to start model download:', error)
        const description = extractErrorMessage(error, '')
        toast.error('Failed to start model download', {
          description: description || 'Unknown error (check DevTools console).',
        })
      })
      .finally(() => {
        window.clearTimeout(startTimeout)
        window.clearTimeout(progressTimeout)
        setStartingState(false)
        removeLocalDownloadingModel(downloadModelId)
        removeLocalDownloadingModel(variant.model_id)
      })
  }, [
    serviceHub,
    variant.path,
    variant.model_id,
    huggingfaceToken,
    model.mmproj_models,
    addLocalDownloadingModel,
    removeDownload,
    removeLocalDownloadingModel,
    setStartingState,
  ])

  const sanitizedModelId = sanitizeModelId(
    variant.model_id.split('/').pop() || variant.model_id
  )
  const isDownloading =
    localDownloadingModels.has(variant.model_id) ||
    downloadProcesses.some(
      (e) => e.id === variant.model_id || e.id === sanitizedModelId
    )
  const downloadProgress =
    downloadProcesses.find(
      (e) => e.id === variant.model_id || e.id === sanitizedModelId
    )?.progress || 0

  if (isDownloading) {
    return (
      <>
        <div className="flex items-center gap-2 w-20">
          <Progress className="border" value={downloadProgress * 100} />
          <span className="text-xs text-center text-muted-foreground">
            {Math.round(downloadProgress * 100)}%
          </span>
        </div>
      </>
    )
  }

  if (isStarting) {
    return (
      <div
        className="size-6 flex items-center justify-center rounded text-muted-foreground"
        title="Starting download"
      >
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (isDownloaded) {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={() =>
          handleUseModel(
            downloadedModel?.modelId ?? variant.model_id,
            downloadedModel?.providerId
          )
        }
        title={t('hub:useModel')}
      >
        {t('hub:newChat')}
      </Button>
    )
  }

  return (
    <div
      className="size-6 cursor-pointer flex items-center justify-center rounded transition-all duration-200 ease-in-out"
      title={t('hub:downloadModel')}
      onClick={handleDownloadModel}
    >
      <Download size={16} className="text-muted-foreground" />
    </div>
  )
}
