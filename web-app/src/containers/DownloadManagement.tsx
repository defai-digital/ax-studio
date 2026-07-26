import { Download, X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import {
  toDownloadProcesses,
  useDownloadStore,
} from '@/hooks/models/useDownloadStore'
import { useLeftPanel } from '@/hooks/ui/useLeftPanel'
import { useServiceHub } from '@/hooks/useServiceHub'
import { DownloadEvent, DownloadState, events } from '@ax-studio/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'

type DownloadProgressRowProps = {
  name: string
  progress: number
  current: number
  total: number
  onCancel?: () => void
}

function formatGigabytes(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(2)
}

function getProgressText({
  progress,
  current,
  total,
}: Pick<DownloadProgressRowProps, 'progress' | 'current' | 'total'>) {
  if (total <= 0) return 'Initializing download...'

  return `${formatGigabytes(current)} / ${formatGigabytes(total)} GB (${Math.round(progress * 100)}%)`
}

function DownloadProgressRow({
  name,
  progress,
  current,
  total,
  onCancel,
}: DownloadProgressRowProps) {
  return (
    <div className="rounded-md p-2">
      <div className="flex items-center justify-between">
        <p className="truncate">{name}</p>
        {onCancel ? (
          <div className="shrink-0 flex items-center space-x-0.5">
            <X
              size={16}
              className="text-muted-foreground cursor-pointer"
              aria-label="Cancel download"
              onClick={onCancel}
            />
          </div>
        ) : null}
      </div>
      <Progress value={progress * 100} className="my-2" />
      <p className="text-muted-foreground text-xs">
        {getProgressText({ progress, current, total })}
      </p>
    </div>
  )
}

export function DownloadManagement() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { open: isLeftPanelOpen } = useLeftPanel()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)
  const serviceHub = useServiceHub()
  const { downloads, localDownloadingModels } = useDownloadStore()

  const getDownloadId = useCallback(
    (state: DownloadState) => state.downloadId ?? state.modelId ?? '',
    []
  )

  const downloadProcesses = useMemo(() => {
    return toDownloadProcesses(downloads, localDownloadingModels)
  }, [downloads, localDownloadingModels])

  const downloadCount = downloadProcesses.length

  const overallProgress = useMemo(() => {
    const modelTotal = downloadProcesses.reduce((acc, download) => {
      return acc + download.total
    }, 0)
    const modelCurrent = downloadProcesses.reduce((acc, download) => {
      return acc + download.current
    }, 0)

    return modelTotal > 0 ? modelCurrent / modelTotal : 0
  }, [downloadProcesses])

  const onFileDownloadError = useCallback(
    (state: DownloadState) => {
      const downloadId = getDownloadId(state)

      const anyState = state as unknown as { error?: string }
      const err = anyState?.error || ''

      if (err.includes('HTTP status 401')) {
        toast.error('Hugging Face token required', {
          id: 'download-failed',
          description:
            'This model requires a Hugging Face access token. Add your token in Settings and retry.',
          action: {
            label: 'Open Settings',
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      if (err.includes('HTTP status 403')) {
        toast.error('Accept model license on Hugging Face', {
          id: 'download-failed',
          description:
            'You must accept the model’s license on its Hugging Face page before downloading.',
        })
        return
      }

      if (err.includes('HTTP status 429')) {
        toast.error('Rate limited by Hugging Face', {
          id: 'download-failed',
          description:
            'You have been rate-limited. Adding a token can increase rate limits. Please try again later.',
          action: {
            label: 'Open Settings',
            onClick: () => navigate({ to: route.settings.general }),
          },
        })
        return
      }

      toast.error(t('common:toast.downloadFailed.title'), {
        id: 'download-failed',
        description: t('common:toast.downloadFailed.description', {
          item: downloadId,
        }),
      })
    },
    [t, navigate, getDownloadId]
  )

  const onModelValidationStarted = useCallback(
    (event: { modelId: string; downloadType: string }) => {
      // Show validation in progress toast
      toast.info(t('common:toast.modelValidationStarted.title'), {
        id: `model-validation-started-${event.modelId}`,
        description: t('common:toast.modelValidationStarted.description', {
          modelId: event.modelId,
        }),
        duration: Infinity,
      })
    },
    [t]
  )

  const onModelValidationFailed = useCallback(
    (event: { modelId: string; error: string; reason: string }) => {
      // Dismiss the validation started toast
      toast.dismiss(`model-validation-started-${event.modelId}`)

      // Show specific toast for validation failure
      toast.error(t('common:toast.modelValidationFailed.title'), {
        description: t('common:toast.modelValidationFailed.description', {
          modelId: event.modelId,
        }),
        duration: 30000,
      })
    },
    [t]
  )

  const onFileDownloadSuccess = useCallback(
    async (state: DownloadState) => {
      const downloadId = getDownloadId(state)

      // Dismiss any validation started toast when download completes successfully
      toast.dismiss(`model-validation-started-${downloadId}`)

      toast.success(t('common:toast.downloadComplete.title'), {
        id: 'download-complete',
        description: t('common:toast.downloadComplete.description', {
          item: downloadId,
        }),
      })
    },
    [t, getDownloadId]
  )

  const onFileDownloadAndVerificationSuccess = useCallback(
    async (state: DownloadState) => {
      const downloadId = getDownloadId(state)

      // Dismiss any validation started toast when download and verification complete successfully
      toast.dismiss(`model-validation-started-${downloadId}`)

      toast.success(t('common:toast.downloadAndVerificationComplete.title'), {
        id: 'download-complete',
        description: t(
          'common:toast.downloadAndVerificationComplete.description',
          {
            item: downloadId,
          }
        ),
      })
    },
    [t, getDownloadId]
  )

  const handleCancelDownload = useCallback(
    (downloadName: string) => {
      serviceHub
        .models()
        .abortDownload(downloadName)
        .then(() => {
          toast.info(t('common:toast.downloadCancelled.title'), {
            id: 'cancel-download',
            description: t('common:toast.downloadCancelled.description'),
          })
          if (downloadProcesses.length === 0) {
            setIsPopoverOpen(false)
          }
        })
        .catch((error) => {
          console.error('[DownloadManagement] Failed to abort download:', error)
          toast.error('Failed to cancel download', {
            id: 'cancel-download',
            description:
              error instanceof Error ? error.message : 'Unknown error',
          })
        })
    },
    [downloadProcesses.length, serviceHub, t]
  )

  useEffect(() => {
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onModelValidationStarted, onModelValidationStarted)
    events.on(DownloadEvent.onModelValidationFailed, onModelValidationFailed)
    events.on(
      DownloadEvent.onFileDownloadAndVerificationSuccess,
      onFileDownloadAndVerificationSuccess
    )

    // Register app update event listeners

    return () => {
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(
        DownloadEvent.onModelValidationStarted,
        onModelValidationStarted
      )
      events.off(DownloadEvent.onModelValidationFailed, onModelValidationFailed)
      events.off(
        DownloadEvent.onFileDownloadAndVerificationSuccess,
        onFileDownloadAndVerificationSuccess
      )

      // Unregister app update event listeners
    }
  }, [
    onFileDownloadError,
    onFileDownloadSuccess,
    onModelValidationStarted,
    onModelValidationFailed,
    onFileDownloadAndVerificationSuccess,
  ])

  return (
    <>
      {downloadCount > 0 && (
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            {isLeftPanelOpen ? (
              <div className="p-2 rounded-md my-1 relative border cursor-pointer text-left">
                <div className="font-studio font-medium flex gap-2 items-center justify-between">
                  <span className="text-sm">{t('downloads')}</span>
                  <div className="bg-primary/50 font-bold size-4 rounded-full  flex items-center justify-center text-xs">
                    <span>{downloadCount}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between space-x-2">
                  <Progress value={overallProgress * 100} />
                  <span className="text-xs font-medium text-left-panel-fg/80 shrink-0">
                    {Math.round(overallProgress * 100)}%
                  </span>
                </div>
              </div>
            ) : (
              <div className="fixed bottom-4 left-4 z-50 size-10 border-2 rounded-full shadow-md cursor-pointer flex items-center justify-center">
                <div className="relative">
                  <Download className="text-muted-foreground -mt-1" size={20} />
                  <div className="bg-primary font-bold size-5 rounded-full absolute -top-4 -right-4 flex items-center justify-center text-xs">
                    <span>{downloadCount}</span>
                  </div>
                </div>
              </div>
            )}
          </PopoverTrigger>

          <PopoverContent
            side="right"
            align="end"
            className="p-0 overflow-hidden text-sm select-none"
            sideOffset={6}
            onFocusOutside={(e) => e.preventDefault()}
          >
            <div className="flex flex-col">
              <div className="px-3 py-2 border-b">
                <p>{t('downloading')}</p>
              </div>
              <div className="p-2 max-h-[300px] overflow-y-auto space-y-2">
                {downloadProcesses.map((download) => (
                  <DownloadProgressRow
                    key={download.id}
                    name={download.name}
                    progress={download.progress}
                    current={download.current}
                    total={download.total}
                    onCancel={() => handleCancelDownload(download.name)}
                  />
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  )
}
