import { Download } from "lucide-react";
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { findDownloadedLocalModel } from '@/lib/models/downloaded'
import { getPreferredMmprojPath } from '@/lib/models'

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
    removeLocalDownloadingModel,
  } =
    useDownloadStore()
  const [isDownloaded, setDownloaded] = useState<boolean>(false)

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
    const handleVerified = (state: DownloadState) => {
      const downloadId = state.downloadId ?? state.modelId
      if (downloadId === variant.model_id || downloadId === sid) setDownloaded(true)
    }
    // Also listen for onModelImported — onFileDownloadAndVerificationSuccess
    // only fires when SHA256 verification is enabled (skipVerification=false).
    // onModelImported fires unconditionally after model.yml is written.
    const handleImported = (payload: { modelId?: string }) => {
      if (payload?.modelId === variant.model_id || payload?.modelId === sid) setDownloaded(true)
    }
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      handleVerified
    )
    events.on(AppEvent.onModelImported, handleImported)
    return () => {
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, handleVerified)
      events.off(AppEvent.onModelImported, handleImported)
    }
  }, [variant.model_id])

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
    // Sanitize model ID so the download directory uses underscores instead of dots.
    // This keeps the on-disk name consistent with what the llamacpp extension expects.
    const baseModelId = variant.model_id.split('/').pop() || variant.model_id
    const downloadModelId = sanitizeModelId(baseModelId)
    addLocalDownloadingModel(variant.model_id)
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
        removeLocalDownloadingModel(variant.model_id)
        const description = extractErrorMessage(error, '')
        toast.error('Failed to start model download', {
          description: description || 'Unknown error (check DevTools console).',
        })
      })
  }, [
    serviceHub,
    variant.path,
    variant.model_id,
    huggingfaceToken,
    model.mmproj_models,
    addLocalDownloadingModel,
    removeLocalDownloadingModel,
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
