import { useEffect } from 'react'
import { useHardware } from '@/hooks/settings/useHardware'
import { useServiceHub } from '@/hooks/useServiceHub'

/**
 * Returns the machine's total RAM in MB — the same hardware telemetry source
 * as the Hardware settings page (`useHardware`).
 *
 * The store is populated when the Hardware settings page (or system monitor)
 * fetches hardware info, and is persisted across sessions. If nothing has
 * populated it yet (e.g. a brand-new user lands on the Hub first), this hook
 * fetches it once in the background.
 *
 * Returns 0 while hardware info is unavailable — callers should degrade
 * gracefully (e.g. hide memory estimates).
 */
export function useHardwareTotalMemory(): number {
  const totalMemory = useHardware((state) => state.hardwareData.total_memory)
  const setHardwareData = useHardware((state) => state.setHardwareData)
  const serviceHub = useServiceHub()

  useEffect(() => {
    if (totalMemory > 0) return
    if (typeof serviceHub.hardware !== 'function') return

    let cancelled = false
    serviceHub
      .hardware()
      .getHardwareInfo()
      .then((data) => {
        if (!cancelled && data) setHardwareData(data)
      })
      .catch((error) => {
        // Hardware info unavailable — callers degrade to file size only.
        console.debug('Failed to fetch hardware info:', error)
      })

    return () => {
      cancelled = true
    }
  }, [totalMemory, serviceHub, setHardwareData])

  return totalMemory
}
