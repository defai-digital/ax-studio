import { useEffect, useRef } from 'react'
import { useTheme, checkOSDarkMode } from '@/hooks/ui/useTheme'
import { isPlatformTauri } from '@/lib/platform/utils'

/**
 * ThemeProvider ensures theme settings are applied on every page load
 * This component should be mounted at the root level of the application
 * It first detects the OS theme preference and applies it accordingly
 */
export function ThemeProvider() {
  const { activeTheme, isDark, setIsDark, setTheme } = useTheme()
  // Mirror `activeTheme` into a ref so the async `listen()` callback
  // always reads the latest value. The effect's dep array does pick up
  // theme changes, but the ref covers the edge case where a delayed
  // `theme-changed` event fires after the user manually switched off
  // `auto` mode but before the effect teardown completes.
  const activeThemeRef = useRef(activeTheme)
  activeThemeRef.current = activeTheme

  // Apply dark class to root element
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  // Detect OS theme on mount and apply it
  useEffect(() => {
    // Force refresh theme on mount to handle Linux startup timing issues
    const refreshTheme = () => {
      if (activeTheme === 'auto') {
        const isDarkMode = checkOSDarkMode()
        setIsDark(isDarkMode)
        setTheme('auto')
      }
    }

    // Initial refresh
    refreshTheme()

    // On Linux, desktop environment may not be ready immediately
    // Add a delayed refresh to catch the correct OS theme
    const timeoutId = setTimeout(refreshTheme, 100)

    // Listen to Tauri native theme events (uses XDG Desktop Portal on Linux)
    let unlistenTauri: (() => void) | undefined

    if (isPlatformTauri()) {
      let isActive = true

      import('@tauri-apps/api/event')
        .then(({ listen }) => {
          return listen<string>('theme-changed', (event) => {
            // Read from the ref, not from the closure snapshot, so a
            // delayed OS event can't flip to dark mode after the user
            // explicitly chose a non-auto theme.
            if (activeThemeRef.current === 'auto') {
              const isDark = event.payload === 'dark'
              setIsDark(isDark)
            }
          })
        })
        .then((unlisten) => {
          if (isActive) {
            unlistenTauri = unlisten
          } else {
            unlisten()
          }
        })
        .catch((err) => {
          if (!isActive) return
          console.error('Failed to setup Tauri theme listener:', err)
        })

      return () => {
        isActive = false
        clearTimeout(timeoutId)
        if (unlistenTauri) {
          unlistenTauri()
        }
      }
    }

    // Clean up
    return () => {
      clearTimeout(timeoutId)
      if (unlistenTauri) {
        unlistenTauri()
      }
    }
  }, [activeTheme, setIsDark, setTheme])

  return null
}
