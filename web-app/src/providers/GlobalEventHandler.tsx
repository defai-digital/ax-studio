import { useEffect } from 'react'
import { events, ModelEvent, AppEvent, DownloadEvent } from '@ax-studio/core'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useGlobalShortcut } from '@/hooks/settings/useGlobalShortcut'
import { useDockFileDrop } from '@/hooks/chat/use-dock-file-drop'
import { COMPOSER_FOCUS_EVENT, SystemEvent } from '@/types/events'
import { isPlatformTauri } from '@/lib/platform/utils'
import { useDownloadStore } from '@/hooks/models/useDownloadStore'
import { useAppState } from '@/hooks/settings/useAppState'
import { autoSelectDownloadedModel } from '@/lib/models/auto-select-downloaded-model'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

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
  LLAMA_CPP_PROCESS_ERROR: 'processCrashed',
}

/**
 * GlobalEventHandler handles global events that should be processed across all screens.
 * This provider is mounted at the root level.
 */
export function GlobalEventHandler() {
  const { setProviders } = useModelProvider()
  const serviceHub = useServiceHub()
  const navigate = useNavigate()
  const { t } = useTranslation()

  // ─── Global wake hotkey ───────────────────────────────────────────────────

  // Register the persisted quick-launch combo once at startup. Registration
  // state is tracked by the service (plugin isRegistered() is unreliable), so
  // a failed registration here only logs — the settings page surfaces remap
  // errors inline when the user picks a combo.
  useEffect(() => {
    const combo = useGlobalShortcut.getState().quickLaunchShortcut
    serviceHub
      .globalShortcut()
      .remap(combo)
      .catch((error) => {
        console.error('[GlobalEventHandler] Failed to register global shortcut:', error)
      })
  }, [serviceHub])

  // Wake: navigate home and focus the composer. The focus dispatch is deferred
  // so a not-yet-mounted home composer can mount first (it also autofocuses on
  // mount; the event covers the already-mounted case).
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    serviceHub
      .events()
      ?.listen(SystemEvent.GLOBAL_WAKE, () => {
        navigate({ to: route.home })
        if (focusTimer) clearTimeout(focusTimer)
        focusTimer = setTimeout(() => {
          if (cancelled) return
          window.dispatchEvent(new CustomEvent(COMPOSER_FOCUS_EVENT))
        }, 50)
      })
      .then((unsub) => {
        if (cancelled) {
          unsub()
          return
        }
        unlisten = unsub
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[GlobalEventHandler] Failed to listen for global wake:', error)
        }
      })
    return () => {
      cancelled = true
      if (focusTimer) clearTimeout(focusTimer)
      unlisten?.()
    }
  }, [serviceHub, navigate])

  // ─── OS file open (macOS Dock drop / Windows "Open with") ───────────────

  const { handleDockFilePaths } = useDockFileDrop()

  // Warm path: listen for `dock-file-drop`. Cold-start path: files opened
  // before the frontend mounted are buffered in Rust — drain them once
  // (the drain also flips the Rust-side ready flag so later drops arrive
  // through the listener). Both navigate home and attach to a new chat.
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    const onPaths = (paths: string[]) => {
      if (!paths.length) return
      navigate({ to: route.home })
      void handleDockFilePaths(paths)
    }

    serviceHub
      .events()
      ?.listen<string[]>(SystemEvent.DOCK_FILE_DROP, (event) => {
        if (Array.isArray(event.payload)) onPaths(event.payload)
      })
      .then((unsub) => {
        if (cancelled) {
          unsub()
          return
        }
        unlisten = unsub
        if (!isPlatformTauri()) return
        serviceHub
          .core()
          .invoke<string[]>('take_pending_open_files')
          .then((paths) => {
            if (!cancelled && Array.isArray(paths)) onPaths(paths)
          })
          .catch((error) => {
            console.error(
              '[GlobalEventHandler] Failed to drain pending open files:',
              error
            )
          })
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [serviceHub, navigate, handleDockFilePaths])

  // ─── Settings changes ───────────────────────────────────────────────────────

  useEffect(() => {
    const handleShowToast = (payload: {
      title?: string
      message?: string
    } | null) => {
      const title = payload?.title?.trim()
      if (!title) return

      const message = payload?.message?.trim()
      toast.info(
        title,
        message ? { description: message } : undefined
      )
    }

    events.on(AppEvent.onShowToast, handleShowToast)
    return () => {
      events.off(AppEvent.onShowToast, handleShowToast)
    }
  }, [])

  useEffect(() => {
    const handleSettingsChanged = async (event: {
      key: string
      value: string
    } | null) => {
      // Refresh providers when version_backend changes so the UI shows the new value
      if (event?.key === 'version_backend') {
        try {
          const updatedProviders = await serviceHub.providers().getProviders()
          setProviders(updatedProviders, serviceHub.path().sep())
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
    // Sequence counter: if model-ready and model-stopped fire close together,
    // both handlers call the async getActiveModels() concurrently. The resolve
    // order isn't guaranteed to match the event order, so the later event's
    // result can be overwritten by the earlier one's result. Dropping stale
    // resolutions by sequence number keeps the active-models indicator
    // consistent with the true event order.
    let eventSeq = 0

    /**
     * OnModelReady — the llamacpp extension emits this after a model is loaded.
     * Register the local provider (llamacpp/mlx) with the proxy so it can inject
     * the correct api_key when forwarding requests to the local server port.
     * Without this, the proxy forwards no Authorization header and the local
     * server responds with "Invalid API Key".
     */
    const handleModelReady = async (payload: {
      modelId?: string
      port?: number
      api_key?: string
      provider?: string
    }) => {
      const seq = ++eventSeq

      // Register the local provider in the proxy's AppState so it knows the
      // base_url (localhost:<port>) and api_key to inject for this session.
      if (payload?.port) {
        const providerName = payload.provider ?? 'llamacpp'
        try {
          await serviceHub.core().invoke('register_provider_config', {
            request: {
              provider: providerName,
              api_key: payload.api_key ?? null,
              base_url: `http://127.0.0.1:${payload.port}/v1`,
              custom_headers: [],
              models: payload.modelId ? [payload.modelId] : [],
            },
          })
        } catch (err) {
          console.error(`[GlobalEventHandler] Failed to register local provider '${providerName}' with proxy:`, err)
        }
      }

      try {
        const active = await serviceHub.models().getActiveModels()
        if (seq !== eventSeq) return
        setActiveModels(active || [])
      } catch (error) {
        if (seq !== eventSeq) return
        console.error('[GlobalEventHandler] Failed to refresh active models after model ready:', error)
      }
    }

    /**
     * OnModelStopped — update active models list and unregister the local provider
     * from the proxy so stale sessions don't linger.
     */
    const handleModelStopped = async (payload?: { provider?: string }) => {
      const seq = ++eventSeq

      const providerName = payload?.provider ?? 'llamacpp'
      try {
        await serviceHub.core().invoke('unregister_provider_config', { provider: providerName })
      } catch (err) {
        console.error(`[GlobalEventHandler] Failed to unregister local provider '${providerName}' from proxy:`, err)
      }

      try {
        const active = await serviceHub.models().getActiveModels()
        if (seq !== eventSeq) return
        setActiveModels(active || [])
      } catch (error) {
        if (seq !== eventSeq) return
        console.error('[GlobalEventHandler] Failed to refresh active models after model stopped:', error)
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
     * Payload: { modelId: string; error: string; provider?: string }
     * The error string may contain an error code from ERROR_CODE_MAP.
     */
    const handleModelFail = (payload: { modelId?: string; error?: string }) => {
      const error = payload?.error ?? ''
      const normalizedError = error.toLowerCase()

      // Detect known error codes
      const matchedCode = Object.keys(ERROR_CODE_MAP).find((code) =>
        error.toUpperCase().includes(code)
      )

      const messageKey = matchedCode
        ? ERROR_CODE_MAP[matchedCode]
        : 'modelLoadFailed'

      const isOOM =
        messageKey === 'outOfMemory' ||
        normalizedError.includes('out of memory') ||
        normalizedError.includes('oom') ||
        normalizedError.includes('failed to allocate')

      const isProcessCrash =
        messageKey === 'processCrashed' ||
        normalizedError.includes('process crashed') ||
        normalizedError.includes('llama.dll') ||
        normalizedError.includes('vulkan') ||
        normalizedError.includes('gpu offload')

      const resolvedMessageKey = isOOM
        ? 'outOfMemory'
        : isProcessCrash
          ? 'processCrashed'
          : messageKey

      const userMessage = t(
        `settings:llamacpp.errors.${resolvedMessageKey}` as Parameters<typeof t>[0]
      )

      const isContextExceeded =
        error.includes('finish_reason') && error.includes('length')
      if (isContextExceeded) {
        toast.error(
          t('settings:llamacpp.errors.contextExceeded' as Parameters<typeof t>[0])
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
    // Provider refresh on model import is handled by bootstrapEvents()
    // (see lib/bootstrap/bootstrap-events.ts) — registering it here too would
    // trigger two concurrent getProviders()/setProviders() calls per import.
    // We only own the user-visible toast notification here.
    const handleModelImported = () => {
      toast.success(
        t('settings:llamacpp.errors.modelImported' as Parameters<typeof t>[0])
      )
    }

    const handleModelValidationFailed = () => {
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
  }, [t])

  // ─── Download events ───────────────────────────────────────────────────────

  const { updateProgress, removeDownload, removeLocalDownloadingModel } = useDownloadStore()

  type DownloadState = {
    downloadId?: string
    modelId: string
    percent?: number
    transferred?: number
    total?: number
    size?: { transferred?: number; total?: number }
  }

  useEffect(() => {
    const getDownloadId = (state: DownloadState) =>
      state.downloadId ?? state.modelId

    const normalizePercent = (value: number) => {
      if (!Number.isFinite(value)) return 0
      const fraction = value > 1 ? value / 100 : value
      return Math.max(0, Math.min(1, fraction))
    }

    const onFileDownloadUpdate = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      const rawPercent = state.percent ?? (state.total ? (state.transferred ?? 0) / state.total : 0)
      const percent = normalizePercent(rawPercent)
      const transferred = state.size?.transferred ?? state.transferred ?? 0
      const total = state.size?.total ?? state.total ?? 0

      updateProgress(downloadId, percent, downloadId, transferred, total)
    }

    const onFileDownloadStarted = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      updateProgress(downloadId, 0, downloadId, 0, 0)
    }

    const onFileDownloadSuccess = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      removeDownload(downloadId)
      removeLocalDownloadingModel(downloadId)

      // S1.1 — auto-select the freshly downloaded model so the home composer
      // is ready to chat. Never opens a chat and never switches the model of
      // a thread the user is currently viewing (handled inside the helper).
      void autoSelectDownloadedModel(state.modelId ?? downloadId).then(
        (result) => {
          if (!result.showFirstModelToast) return
          toast.success(`${result.modelId} is ready — start chatting`, {
            action: {
              label: 'New chat',
              onClick: () => navigate({ to: route.home }),
            },
          })
        }
      )
    }

    const onFileDownloadError = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      removeDownload(downloadId)
      removeLocalDownloadingModel(downloadId)
    }

    const onFileDownloadStopped = (state: DownloadState) => {
      const downloadId = getDownloadId(state)
      removeDownload(downloadId)
      removeLocalDownloadingModel(downloadId)
    }

    events.on(DownloadEvent.onFileDownloadStarted, onFileDownloadStarted)
    events.on(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
    events.on(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
    events.on(DownloadEvent.onFileDownloadError, onFileDownloadError)
    events.on(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
    events.on(DownloadEvent.onFileDownloadAndVerificationSuccess, onFileDownloadSuccess)

    return () => {
      events.off(DownloadEvent.onFileDownloadStarted, onFileDownloadStarted)
      events.off(DownloadEvent.onFileDownloadUpdate, onFileDownloadUpdate)
      events.off(DownloadEvent.onFileDownloadSuccess, onFileDownloadSuccess)
      events.off(DownloadEvent.onFileDownloadError, onFileDownloadError)
      events.off(DownloadEvent.onFileDownloadStopped, onFileDownloadStopped)
      events.off(DownloadEvent.onFileDownloadAndVerificationSuccess, onFileDownloadSuccess)
    }
  }, [updateProgress, removeDownload, removeLocalDownloadingModel, navigate])

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
              // Navigate via TanStack Router — the app is path-based, so
              // setting `window.location.hash` only added a URL fragment
              // and did nothing to the visible route.
              navigate({ to: route.settings.hardware })
            },
          },
        }
      )
    }

    events.on('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    return () => {
      events.off('onBackendUpdateAvailable', handleBackendUpdateAvailable)
    }
  }, [t, navigate])

  return null
}
