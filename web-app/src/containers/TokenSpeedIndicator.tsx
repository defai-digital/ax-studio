import { memo } from 'react'
import { useAppState } from '@/hooks/settings/useAppState'
import { toNumber } from '@/lib/utils/number'
import { Gauge } from 'lucide-react'

interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface TokenSpeed {
  tokenSpeed: number
  tokenCount?: number
  durationMs?: number
  generationTokenCount?: number
  totalDurationMs?: number
  timeToFirstTokenMs?: number
  accelerationMode?: 'mtp' | 'mtp_fallback' | 'direct'
  mtpAcceptanceRate?: number
}

interface TokenSpeedIndicatorProps {
  metadata?: Record<string, unknown>
  streaming?: boolean
}

function formatLatency(durationMs: number): string {
  return durationMs < 1000
    ? `${Math.round(durationMs)}ms`
    : `${(durationMs / 1000).toFixed(1)}s`
}

export const TokenSpeedIndicator = memo(
  ({ metadata, streaming }: TokenSpeedIndicatorProps) => {
    // Get real-time token speed from global state during streaming
    const streamingTokenSpeed = useAppState((state) =>
      state.tokenSpeed ? Math.round(state.tokenSpeed.tokenSpeed) : 0
    )
    const streamingTokenCount = useAppState(
      (state) => state.tokenSpeed?.tokenCount || 0
    )

    // Fallback to persisted metadata when not streaming
    const persistedMetrics = metadata?.tokenSpeed as TokenSpeed | undefined
    const persistedTokenSpeed = persistedMetrics?.tokenSpeed || 0
    const persistedTokenCount = persistedMetrics?.tokenCount || 0
    const usage = metadata?.usage as TokenUsage | undefined

    const nonStreamingAssistantParam =
      typeof metadata?.assistant === 'object' &&
      metadata?.assistant !== null &&
      'parameters' in metadata.assistant
        ? (metadata.assistant as { parameters?: { stream?: boolean } })
            .parameters?.stream === false
        : undefined

    if (nonStreamingAssistantParam) return

    // Use streaming data if available, otherwise fall back to metadata
    const displaySpeed = streaming
      ? streamingTokenSpeed
      : Math.round(toNumber(persistedTokenSpeed))

    const displayTokenCount = streaming
      ? streamingTokenCount
      : (usage?.outputTokens ?? persistedTokenCount)

    // Hide the indicator if token speed is 0 and not streaming
    if (displaySpeed === 0) return

    // Show indicator during streaming OR when we have persisted data
    const shouldShow = streaming || (displaySpeed > 0 && displayTokenCount > 0)

    if (!shouldShow) return

    const accelerationLabel = !streaming
      ? persistedMetrics?.accelerationMode === 'mtp'
        ? Number.isFinite(persistedMetrics.mtpAcceptanceRate)
          ? `MTP ${Math.round((persistedMetrics.mtpAcceptanceRate ?? 0) * 100)}%`
          : 'MTP'
        : persistedMetrics?.accelerationMode === 'mtp_fallback'
          ? 'MTP fallback'
          : persistedMetrics?.accelerationMode === 'direct'
            ? 'Direct'
            : undefined
      : undefined
    const timeToFirstTokenLabel =
      !streaming &&
      persistedMetrics?.timeToFirstTokenMs != null &&
      Number.isFinite(persistedMetrics.timeToFirstTokenMs) &&
      persistedMetrics.timeToFirstTokenMs >= 0
        ? `TTFT ${formatLatency(persistedMetrics.timeToFirstTokenMs)}`
        : undefined

    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground/40">
        <Gauge size={12} />
        <span>{displaySpeed} t/s</span>
        {displayTokenCount > 0 && (
          <span>&middot; {displayTokenCount} tokens</span>
        )}
        {accelerationLabel && <span>&middot; {accelerationLabel}</span>}
        {timeToFirstTokenLabel && (
          <span>&middot; {timeToFirstTokenLabel}</span>
        )}
      </div>
    )
  }
)
