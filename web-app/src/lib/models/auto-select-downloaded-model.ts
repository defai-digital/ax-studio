/**
 * auto-select-downloaded-model — S1.1 first-run success loop.
 *
 * When a model download completes, select it as the current model so the
 * home composer is ready to chat (upstream Jan issue #7566). The selection
 * uses the exact same mechanisms as a manual pick in the composer dropdown:
 * `useModelProvider.selectModelProvider` + the `lastUsedModel` localStorage
 * entry that the new-chat home falls back to.
 *
 * Guarantees:
 * - Never opens a chat on its own.
 * - Never switches the model of a thread the user is currently viewing —
 *   in that case only the last-used entry is written, so the next new chat
 *   picks the downloaded model up.
 * - Reports whether this was the user's FIRST downloaded model so the
 *   caller can greet them with a toast.
 */
import { LOCAL_PROVIDER_IDS } from '@/constants/providers'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useThreads } from '@/hooks/threads/useThreads'
import { findDownloadedLocalModel } from '@/lib/models/downloaded'
import { setLastUsedModel } from '@/lib/utils/getModelToStart'

/**
 * The provider refresh after a completed download is triggered by the
 * `onModelImported` event (see lib/bootstrap/bootstrap-events.ts), which
 * fires after the model manifest is written — i.e. AFTER the download
 * success event. Wait for the model to show up before selecting it.
 */
const WAIT_FOR_MODEL_TIMEOUT_MS = 15_000

/**
 * Each completed download emits both `onFileDownloadSuccess` and
 * `onFileDownloadAndVerificationSuccess` (milliseconds apart) — collapse
 * them into a single auto-select.
 */
const DEDUPE_WINDOW_MS = 30_000

const recentlyHandled = new Map<string, number>()

/** Show the first-download toast at most once per session. */
let firstModelToastConsumed = false

export const hasDownloadedLocalModel = (providers: ModelProvider[]): boolean =>
  providers.some(
    (provider) =>
      LOCAL_PROVIDER_IDS.has(provider.provider) &&
      (provider.models?.length ?? 0) > 0
  )

const waitForDownloadedModel = (
  modelId: string,
  timeoutMs = WAIT_FOR_MODEL_TIMEOUT_MS
): Promise<{ modelId: string; providerId: string } | undefined> =>
  new Promise((resolve) => {
    const resolveWithMatch = () =>
      findDownloadedLocalModel(useModelProvider.getState().providers, modelId)

    const existing = resolveWithMatch()
    if (existing) {
      resolve(existing)
      return
    }

    const timeout = setTimeout(() => {
      unsubscribe()
      resolve(resolveWithMatch())
    }, timeoutMs)

    const unsubscribe = useModelProvider.subscribe(() => {
      const match = resolveWithMatch()
      if (match) {
        clearTimeout(timeout)
        unsubscribe()
        resolve(match)
      }
    })
  })

export type AutoSelectDownloadedModelResult = {
  status: 'selected' | 'thread-preserved' | 'unavailable' | 'duplicate'
  /**
   * True only when this was the user's first downloaded model AND the
   * first-download toast has not been shown yet this session.
   */
  showFirstModelToast: boolean
  modelId: string
  providerId?: string
}

export const autoSelectDownloadedModel = async (
  modelId: string,
  options?: { timeoutMs?: number }
): Promise<AutoSelectDownloadedModelResult> => {
  const now = Date.now()
  const lastHandled = recentlyHandled.get(modelId)
  if (lastHandled !== undefined && now - lastHandled < DEDUPE_WINDOW_MS) {
    return { status: 'duplicate', showFirstModelToast: false, modelId }
  }
  recentlyHandled.set(modelId, now)

  // Capture BEFORE the provider refresh lands: no local models yet means
  // this is the user's first downloaded model.
  const isFirstModel = !hasDownloadedLocalModel(
    useModelProvider.getState().providers
  )

  const match = await waitForDownloadedModel(modelId, options?.timeoutMs)
  if (!match) {
    return { status: 'unavailable', showFirstModelToast: false, modelId }
  }

  // Same "remember last used model" mechanism the composer dropdown uses —
  // harmless even when a thread is open, and makes the next new chat pick
  // the downloaded model.
  setLastUsedModel(match.providerId, match.modelId)

  // Do not switch the model of a thread the user is currently viewing.
  const isViewingThread = Boolean(useThreads.getState().currentThreadId)
  if (!isViewingThread) {
    useModelProvider
      .getState()
      .selectModelProvider(match.providerId, match.modelId)
  }

  const showFirstModelToast = isFirstModel && !firstModelToastConsumed
  if (showFirstModelToast) firstModelToastConsumed = true

  return {
    status: isViewingThread ? 'thread-preserved' : 'selected',
    showFirstModelToast,
    modelId: match.modelId,
    providerId: match.providerId,
  }
}

/** Test-only: reset module-level dedupe/toast state between tests. */
export const __resetAutoSelectDownloadedModelState = () => {
  recentlyHandled.clear()
  firstModelToastConsumed = false
}
