/**
 * bootstrap-updater — starts the periodic update check interval.
 * Pure function; no React, no Zustand imports.
 *
 * Returns a cleanup function that clears the interval.
 * The caller is responsible for calling cleanup on unmount.
 */
export type BootstrapUpdaterInput = {
  checkForUpdate: () => void
  isDev: boolean
}

/**
 * Performs an initial update check and schedules periodic checks.
 * @returns cleanup — call on unmount to stop the interval.
 */
export function bootstrapUpdater(input: BootstrapUpdaterInput): () => void {
  const { checkForUpdate, isDev } = input

  if (isDev) {
    return () => {}
  }

  checkForUpdate()

  const intervalId = setInterval(() => {
    checkForUpdate()
  }, Number(UPDATE_CHECK_INTERVAL_MS))

  return () => clearInterval(intervalId)
}
