import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo } from 'react'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { TranslationContext } from './context'
import { i18n as i18next } from './setup'

// Translation provider component
export function TranslationProvider({ children }: { children: ReactNode }) {
  // Get the current language from general settings
  const { currentLanguage } = useGeneralSetting()

  // Update language when currentLanguage changes
  useEffect(() => {
    if (currentLanguage) {
      i18next.changeLanguage(currentLanguage)
    }
  }, [currentLanguage])

  const translate = useCallback(
    (key: string, options?: Record<string, unknown>) => {
      const optionsWithLanguage = currentLanguage
        ? {
            ...options,
            lng:
              typeof options?.lng === 'string' ? options.lng : currentLanguage,
          }
        : options
      return i18next.t(key, optionsWithLanguage)
    },
    [currentLanguage]
  )

  const contextValue = useMemo(
    () => ({
      t: translate,
      i18n: i18next,
    }),
    [translate]
  )

  return (
    <TranslationContext.Provider value={contextValue}>
      {children}
    </TranslationContext.Provider>
  )
}
