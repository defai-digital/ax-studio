import type { ReactNode } from 'react'
import { useCallback, useMemo } from 'react'
import { TranslationContext } from './context'
import { i18n as i18next } from './setup'

// Translation provider component
export function TranslationProvider({ children }: { children: ReactNode }) {
  const translate = useCallback(
    (key: string, options?: Record<string, unknown>) =>
      i18next.t(key, options),
    []
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
