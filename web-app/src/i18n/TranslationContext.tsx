import React, { ReactNode, useEffect, useCallback } from "react"
import i18next, { loadTranslations } from "./setup"
import { useGeneralSetting } from "@/hooks/settings/useGeneralSetting"
import { TranslationContext } from "./context"

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// Get the current language from general settings
	const { currentLanguage } = useGeneralSetting()

	// Load translations once when the component mounts
	useEffect(() => {
		try {
			loadTranslations()
		} catch (error) {
			console.error("Failed to load translations:", error)
		}
	}, [])

	// Update language when currentLanguage changes
	useEffect(() => {
		if (currentLanguage) {
			i18next.changeLanguage(currentLanguage)
		}
	}, [currentLanguage])

	// Include `currentLanguage` in the dep list so the callback reference
	// changes on every language switch. Without this, context consumers
	// don't re-render because the provider's value object is reference-
	// equal across language changes — `i18next.t()` reads the current
	// language at call time, but React doesn't know a re-render is needed.
	const translate = useCallback(
		(key: string, options?: Record<string, unknown>) => {
			return i18next.t(key, options)
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[currentLanguage],
	)

	return (
		<TranslationContext.Provider
			value={{
				t: translate,
				i18n: i18next,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

export default TranslationProvider
