import { useEffect } from 'react'
import {
  useInterfaceSettings,
  applyAccentColorToDOM,
} from '@/hooks/useInterfaceSettings'
import { useTheme } from '@/hooks/useTheme'

/**
 * InterfaceProvider ensures interface settings are applied on every page load.
 * This component should be mounted at the root level of the application.
 */
export function InterfaceProvider() {
  const { fontSize, accentColor } = useInterfaceSettings()
  const { isDark } = useTheme()

  // Apply font size on mount and when it changes
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-base', fontSize)
  }, [fontSize])

  // Apply accent color when it changes or theme changes
  useEffect(() => {
    applyAccentColorToDOM(accentColor, isDark)
  }, [accentColor, isDark])

  return null
}
