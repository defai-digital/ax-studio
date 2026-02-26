import { useEffect } from 'react'
import { events, ModelEvent, AppEvent, DownloadEvent } from '@ax-fabric/core'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDownloadStore } from '@/hooks/useDownloadStore'
import { useAppState } from '@/hooks/useAppState'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { invoke } from '@tauri-apps/api/core'

// Map Rust error code strings to i18n keys in settings:llamacpp.errors
const ERROR_CODE_MAP: Record<string, string> = {
  BINARY_NOT_FOUND: 'binaryNotFound',
  MODEL_FILE_NOT_FOUND: 'modelFileNotFound',
  MODEL_LOAD_FAILED: 'modelLoadFailed',
  MODEL_LOAD_TIMED_OUT: 'modelLoadTimedOut',
  OUT_OF_MEMORY: 'outOfMemory',
  MODEL_ARCH_NOT_SUPPORTED: 'modelArchNotSupported',
  MULTIMODAL_PROJECTOR_LOAD_FAILED: 'multimodalProjectorLoadFailed',
  DEVICE_LIST_PARSE_FAILED: 'deviceListParseFailed',
  INVALID_ARGUMENT: 'invalidArgument',
}

/**
 * GlobalEventHandler handles global events that should be processed across all screens.
 * This provider is mounted at the root level.
 */
export function GlobalEventHandler() {
  const { setProviders } = useModelProvider()
  const serviceHub = useServiceHub()
  const { t } = useTranslation()

  // ─── Settings changes ───────────────────────────────────────────────────────

  useEffect(() => {
    const handleSettingsChanged = async (event: {
      key: string
      value: string
    }) => {
      // Refresh providers when version_backend changes so the UI shows the new value
      if (event.key === 'version_backend') {
        try {
          const updatedProviders = await serviceHub.providers().getProviders()
          setProviders(updatedProviders)
        } catch (error) {
          console.error('Failed to refresh providers after settingsChanged:', error)
        }
      }
    }

    events.on('settingsChanged', handleSettingsChanged)
    return () => {
      events.off('settingsChanged', handleSettingsChanged)
    }
  }, [setProviders, serviceHub])

  // ─── Model load / ready / fail events ───────────────────────────────────────

  const setActiveModels = useAppState((state) => state.setActiveModels)

  useEffect(() => {
    /**
     * OnModelReady — the llamacpp extension emits this after a model is loaded.
     * Payload includes port and api_key so we can register the local
     * llama-server with the Rust proxy (provider_configs).
     */
    const handleModelReady = async (payload: {
      modelId?: string
      port?: number
      api_key?: string
      provider?: string
    }) => {
      const { modelId, port, api_key, provider } = payload ?? {}
      if (!modelId || !port || !provider) return

      // Register the local provider with the Rust proxy so chat requests are routed correctly
      const localProviders = ['llamacpp', 'mlx', 'ollama']
      if (localProviders.includes(provider)) {
        try {
          await invoke('register_provider_config', {
            request: {
              provider,
              base_url: `http://localhost:${port}/v1`,
              api_key: api_key ?? '',
              custom_headers: [],
              models: [modelId],
            },
          })
          console.log(`Registered local provider '${provider}' (model: ${modelId}) with proxy at port ${port}`)
        } catch (error) {
          console.error('Failed to register local provider with proxy:', error)
        }
      }

      // Update active models list
      try {
        const active = await serviceHub.models().getActiveModels()
        setActiveModels(active || [])
      } catch {
        // ignore
      }
    }

    /**
     * OnModelStopped — update active models list when a model is unloaded.
     */
    const handleModelStopped = async () => {
      try {
        const active = await serviceHub.models().getActiveModels()
        setActiveModels(active || [])
      } catch {
        // ignore
      }
    }

    events.on(ModelEvent.OnModelReady, handleModelReady)
    events.on(ModelEvent.OnModelStopped, handleModelStopped)
    return () => {
      events.off(ModelEvent.OnModelReady, handleModelReady)
      events.off(ModelEvent.OnModelStopped, handleModelStopped)
    }
  }, [serviceHub, setActiveModels])

  useEffect(() => {
    /**
     * OnModelFail — the llamacpp extension emits this when a model fails to load.
     * Payload: { modelId: string; error: string }
     * The error string may contain an error code from ERROR_CODE_MAP.
     */
    const handleModelFail = (payload: { modelId?: string; error?: string }) => {
      const error = payload?.error ?? ''

      // Detect known error codes
      const matchedCode = Object.keys(ERROR_CODE_MAP).find((code) =>
        error.toUpperCase().includes(code)
      )

      const messageKey = matchedCode
        ? ERROR_CODE_MAP[matchedCode]
        : 'modelLoadFailed'

      const userMessage = t(
        `settings:llamacpp.errors.${messageKey}` as Parameters<typeof t>[0]
      )

      // Special human-friendly overrides for context-exceeded
      const isContextExceeded =
        error.includes('finish_reason') && error.includes('length')
      if (isContextExceeded) {
        toast.error(
          t('settings:llamacpp.errors.contextExceeded' as Parameters<typeof t>[0])
        )
        return
      }

      // OOM heuristic
      const isOOM =
        error.toLowerCase().includes('out of memory') ||
        error.toLowerCase().includes('oom') ||
        error.toLowerCase().includes('failed to allocate')
      if (isOOM) {
        toast.error(
          t('settings:llamacpp.errors.outOfMemory' as Parameters<typeof t>[0])
        )
        return
      }

      toast.error(userMessage)
    }

    events.on(ModelEvent.OnModelFail, handleModelFail)
    return () => {
      events.off(ModelEvent.OnModelFail, handleModelFail)
    }
  }, [t])

  // ─── Model import / validation events ──────────────────────────────────────

  useEffect(() => {
    const handleModelImported = async (_payload: any) => {
      // Refresh providers list to show the newly downloaded model
      try {
        const updatedProviders = await serviceHub.providers().getProviders()
        setProviders(updatedProviders)
      } catch (error) {
        console.error('Failed to refresh providers after import:', error)
      }

      toast.success(
        t('settings:llamacpp.errors.modelImported' as Parameters<typeof t>[0])
      )
    }

    const handleModelValidationFailed = (_payload: any) => {
      toast.error(
        t('settings:llamacpp.errors.modelValidationFailed' as Parameters<typeof t>[0])
      )
    }

    events.on(AppEvent.onModelImported, handleModelImported)
    events.on(DownloadEvent.onModelValidationFailed, handleModelValidationFailed)

    return () => {
      events.off(AppEvent.onModelImported, handleModelImported)
      events.off(DownloadEvent.onModelValidationFailed, handleModelValidationFailed)
    }
  }, [t, serviceHub, setProviders])

  // ─── Download events ───────────────────────────────────────────────────────

  const { updateProgress, removeDownload, removeLocalDownloadingModel } = useDownloadStore()

  useEffect(() => {
    const onFileDownloadUpdate = (state: any) => {
      // Be resilient to different payload structures
      const modelId = state.modelId
      const percent = state.percent ?? (state.total ? state.transferred / state.total : 0)
      const transferred = state.size?.transferred ?? state.transferred ?? 0
      const total = state.size?.total ?? state.total ?? 0

      updateProgress(
        modelId,
        percent,
        modelId,
        transferred,
        total
      )
    }

    const onFileDownloadSuccess = (state: any) => {
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    }

    const onFileDownloadError = (state: any) => {
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    }

    const onFileDownloadStopped = (state: any) => {
      removeDownload(state.modelId)
      removeLocalDownloadingModel(state.modelId)
    }

    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
    events.on(DownloadEvent.onFileDownloadAndVerificationSuccess, onFileDownloadSuccess)

    return () => {
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, onFileDownloadSuccess)
    }
  }, [updateProgress, removeDownload, removeLocalDownloadingModel])

  // ─── Backend update available ───────────────────────────────────────────────

  useEffect(() => {
    const handleBackendUpdateAvailable = (updateInfo: {
      newVersion?: string
      updateNeeded?: boolean
    }) => {
      if (!updateInfo?.updateNeeded) return

      const version = updateInfo.newVersion ?? ''
      toast.info(
        t('settings:llamacpp.errors.backendUpdateAvailable' as Parameters<typeof t>[0], {
          version,
        }),
        {
          duration: 8000,
          action: {
            label: t('settings:hardware.updateNow' as Parameters<typeof t>[0]),
            onClick: () => {
              // Navigate to hardware settings — user can click "Update Now" there
              window.location.hash = '#/settings/hardware'
            },
          },
        }
      )
    }

    events.on('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    return () => {
      events.off('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    }
  }, [t])

  return null
}
