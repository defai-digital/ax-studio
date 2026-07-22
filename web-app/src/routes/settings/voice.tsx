import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { SettingsMenu } from '@/components/common/SettingsMenu'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { HeaderPage } from '@/containers/HeaderPage'
import { Download, Mic as MicIcon, Trash2 } from 'lucide-react'
import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useVoiceSettings } from '@/hooks/settings/useVoiceSettings'
import {
  VOICE_MODELS,
  voiceModelDownloadEvent,
  type VoiceModelDownloadProgress,
  type VoiceModelId,
} from '@/services/voice/types'
import { toast } from 'sonner'

export const Route = createFileRoute(route.settings.voice)({
  component: VoiceSettings,
})

/** Per-model download UI state. */
type ModelState =
  | { status: 'not-downloaded' }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded' }

const MODEL_IDS = Object.keys(VOICE_MODELS) as VoiceModelId[]

function VoiceSettings() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const voiceInputEnabled = useVoiceSettings(
    (state) => state.voiceInputEnabled
  )
  const setVoiceInputEnabled = useVoiceSettings(
    (state) => state.setVoiceInputEnabled
  )
  const voiceModel = useVoiceSettings((state) => state.voiceModel)
  const setVoiceModel = useVoiceSettings((state) => state.setVoiceModel)

  const [models, setModels] = useState<Record<VoiceModelId, ModelState>>(() =>
    Object.fromEntries(
      MODEL_IDS.map((id) => [id, { status: 'not-downloaded' }])
    ) as Record<VoiceModelId, ModelState>
  )
  const modelGenerationRef = useRef<Record<VoiceModelId, number>>(
    Object.fromEntries(MODEL_IDS.map((id) => [id, 0])) as Record<
      VoiceModelId,
      number
    >
  )

  const setModelState = useCallback(
    (id: VoiceModelId, value: ModelState) =>
      setModels((prev) => ({ ...prev, [id]: value })),
    []
  )

  const refreshModel = useCallback(
    async (id: VoiceModelId) => {
      const generation = modelGenerationRef.current[id]
      try {
        const status = await serviceHub.voice().getStatus(id)
        if (generation !== modelGenerationRef.current[id]) return
        setModelState(
          id,
          status.modelDownloaded
            ? { status: 'downloaded' }
            : { status: 'not-downloaded' }
        )
      } catch (error) {
        if (generation !== modelGenerationRef.current[id]) return
        console.error('Failed to query voice model status:', error)
      }
    },
    [serviceHub, setModelState]
  )

  useEffect(() => {
    const generations = modelGenerationRef.current
    MODEL_IDS.forEach((id) => {
      void refreshModel(id)
    })
    return () => {
      MODEL_IDS.forEach((id) => {
        generations[id] += 1
      })
    }
  }, [refreshModel])

  // Download progress arrives on `download-voice-model-{id-with-dashes}`
  // with the shared DownloadEvent payload (transferred/total bytes).
  useEffect(() => {
    const eventsService = serviceHub.events()
    if (!eventsService) return
    let unmounted = false
    const unlistens: Array<() => void> = []
    const safelyUnlisten = (unlisten: () => void) => {
      try {
        unlisten()
      } catch (error) {
        console.error(
          'Failed to remove a voice download event listener:',
          error
        )
      }
    }

    Promise.allSettled(
      MODEL_IDS.map((id) =>
        eventsService.listen<VoiceModelDownloadProgress>(
          voiceModelDownloadEvent(id),
          (event) => {
            if (unmounted) return
            const { transferred, total } = event.payload ?? {}
            const progress =
              total > 0
                ? Math.min(100, Math.round((transferred / total) * 100))
                : 0
            setModels((prev) =>
              prev[id].status === 'downloading'
                ? { ...prev, [id]: { status: 'downloading', progress } }
                : prev
            )
          }
        )
      )
    )
      .then((registrations) => {
        const handles = registrations.flatMap((registration) =>
          registration.status === 'fulfilled' ? [registration.value] : []
        )
        if (unmounted) handles.forEach(safelyUnlisten)
        else unlistens.push(...handles)
        for (const registration of registrations) {
          if (registration.status === 'rejected' && !unmounted) {
            console.error(
              'Failed to subscribe to a voice download event:',
              registration.reason
            )
          }
        }
      })

    return () => {
      unmounted = true
      unlistens.forEach(safelyUnlisten)
    }
  }, [serviceHub])

  const handleDownload = async (id: VoiceModelId) => {
    const generation = ++modelGenerationRef.current[id]
    setModelState(id, { status: 'downloading', progress: 0 })
    try {
      await serviceHub.voice().downloadModel(id)
      if (generation !== modelGenerationRef.current[id]) return
      setModelState(id, { status: 'downloaded' })
    } catch (error) {
      if (generation !== modelGenerationRef.current[id]) return
      console.error('Voice model download failed:', error)
      setModelState(id, { status: 'not-downloaded' })
      toast.error(t('settings:voice.downloadFailed'))
    }
  }

  const handleCancelDownload = async (id: VoiceModelId) => {
    // Invalidate the in-flight download only after cancellation succeeds. If
    // cancellation fails, its original completion must still be able to move
    // the UI out of the downloading state.
    const generation = modelGenerationRef.current[id]
    try {
      await serviceHub.voice().cancelModelDownload(id)
      if (generation !== modelGenerationRef.current[id]) return
      modelGenerationRef.current[id] = generation + 1
      setModelState(id, { status: 'not-downloaded' })
    } catch (error) {
      if (generation !== modelGenerationRef.current[id]) return
      console.error('Voice model download cancellation failed:', error)
      toast.error(t('settings:voice.cancelFailed'))
    }
  }

  const handleDelete = async (id: VoiceModelId) => {
    const generation = ++modelGenerationRef.current[id]
    try {
      await serviceHub.voice().deleteModel(id)
      if (generation !== modelGenerationRef.current[id]) return
      setModelState(id, { status: 'not-downloaded' })
    } catch (error) {
      if (generation !== modelGenerationRef.current[id]) return
      console.error('Voice model delete failed:', error)
      toast.error(t('settings:voice.deleteFailed'))
    }
  }

  const statusLabel = (id: VoiceModelId): string => {
    const state = models[id]
    switch (state.status) {
      case 'downloaded':
        return t('settings:voice.downloaded')
      case 'downloading':
        return t('settings:voice.downloading')
      default:
        return t('settings:voice.notDownloaded')
    }
  }

  const renderModelActions = (id: VoiceModelId) => {
    const state = models[id]
    if (state.status === 'downloading') {
      return (
        <div className="flex items-center gap-2">
          <Progress
            value={state.progress}
            className="w-24"
            data-testid={`voice-model-progress-${id}`}
          />
          <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">
            {state.progress}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCancelDownload(id)}
            data-testid={`voice-model-cancel-${id}`}
          >
            {t('settings:voice.cancel')}
          </Button>
        </div>
      )
    }
    if (state.status === 'downloaded') {
      return (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleDelete(id)}
          data-testid={`voice-model-delete-${id}`}
        >
          <Trash2 size={14} className="mr-1" />
          {t('settings:voice.delete')}
        </Button>
      )
    }
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleDownload(id)}
        data-testid={`voice-model-download-${id}`}
      >
        <Download size={14} className="mr-1" />
        {t('settings:voice.download')}
      </Button>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'thin' }}
        >
          <SettingsPageLayout icon={MicIcon} title={t('common:voice')} />
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* Voice input toggle + model selection */}
              <Card title={t('settings:voice.input')}>
                <CardItem
                  title={t('settings:voice.enable')}
                  description={t('settings:voice.enableDesc')}
                  descriptionOutside={t('settings:voice.onDeviceNote')}
                  actions={
                    <Switch
                      checked={voiceInputEnabled}
                      onCheckedChange={setVoiceInputEnabled}
                      data-testid="voice-enable-switch"
                    />
                  }
                />
                <CardItem
                  title={t('settings:voice.model')}
                  description={t('settings:voice.modelDesc')}
                  actions={
                    <select
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
                      value={voiceModel}
                      onChange={(event) =>
                        setVoiceModel(event.target.value as VoiceModelId)
                      }
                      data-testid="voice-model-select"
                    >
                      {Object.values(VOICE_MODELS).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label} ({model.sizeLabel})
                        </option>
                      ))}
                    </select>
                  }
                />
              </Card>

              {/* Model downloads */}
              <Card title={t('settings:voice.models')}>
                {Object.values(VOICE_MODELS).map((model) => (
                  <CardItem
                    key={model.id}
                    title={model.label}
                    description={`${model.sizeLabel} · ${statusLabel(model.id)}`}
                    actions={renderModelActions(model.id)}
                  />
                ))}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
