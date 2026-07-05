import { localStorageKey } from '@/constants/localStorage'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage/storage'

// Validation helper for stored settings structure
const isValidStoredSettings = (
  parsed: unknown
): parsed is { state: { currentLanguage: string } } => {
  if (typeof parsed !== 'object' || parsed === null) return false
  const obj = parsed as Record<string, unknown>
  if (typeof obj.state !== 'object' || obj.state === null) return false
  const state = obj.state as Record<string, unknown>
  return typeof state.currentLanguage === 'string'
}

// Types for our i18n implementation
export interface TranslationResources {
  [language: string]: {
    [namespace: string]: {
      [key: string]: unknown
    }
  }
}

export interface I18nInstance {
  language: string
  fallbackLng: string
  resources: TranslationResources
  namespaces: string[]
  defaultNS: string
  changeLanguage: (lng: string) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

// Global i18n instance
let i18nInstance: I18nInstance

type TranslationOptions = Record<string, unknown> & {
  lng?: string
}

// Dynamically load locale files
const localeFiles = import.meta.glob('../locales/**/*.json', { eager: true })

const resources: TranslationResources = {}
const namespaces: string[] = []

// Process all locale files
Object.entries(localeFiles).forEach(([path, module]) => {
  // Example path: '../locales/en/common.json' -> language: 'en', namespace: 'common'
  const match = path.match(/\.\.\/locales\/([^/]+)\/([^/]+)\.json/)

  if (match) {
    const [, language, namespace] = match

    // Initialize language object if it doesn't exist
    if (!resources[language]) {
      resources[language] = {}
    }

    // Add namespace to list if it's not already there
    if (!namespaces.includes(namespace)) {
      namespaces.push(namespace)
    }

    // Add namespace resources to language
    resources[language][namespace] =
      (module as { default: { [key: string]: string } }).default ||
      (module as { [key: string]: string })
  }
})

function flattenTranslationKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nestedValue]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key
      return flattenTranslationKeys(nestedValue, nextPrefix)
    }
  )
}

function getCompleteLanguages(minCoverage = 0.95): string[] {
  const englishResources = resources.en
  if (!englishResources) return ['en']

  const expectedKeys = new Set(
    Object.entries(englishResources).flatMap(([namespace, namespaceValues]) =>
      flattenTranslationKeys(namespaceValues).map(
        (key) => `${namespace}:${key}`
      )
    )
  )

  if (expectedKeys.size === 0) return ['en']

  return Object.entries(resources)
    .filter(([language, languageResources]) => {
      if (language === 'en') return true
      const languageKeys = new Set(
        Object.entries(languageResources).flatMap(
          ([namespace, namespaceValues]) =>
            flattenTranslationKeys(namespaceValues).map(
              (key) => `${namespace}:${key}`
            )
        )
      )
      let matched = 0
      for (const key of expectedKeys) {
        if (languageKeys.has(key)) matched += 1
      }
      return matched / expectedKeys.size >= minCoverage
    })
    .map(([language]) => language)
}

// Get stored language preference
const getStoredLanguage = (): string => {
  try {
    const stored = safeStorageGetItem(
      localStorage,
      localStorageKey.settingGeneral,
      'i18n'
    )
    const parsed = stored ? JSON.parse(stored) : {}
    if (isValidStoredSettings(parsed)) {
      return getCompleteLanguages().includes(parsed.state.currentLanguage)
        ? parsed.state.currentLanguage
        : 'en'
    }
    return 'en'
  } catch {
    return 'en'
  }
}

// Translation function
const translate = (key: string, options: TranslationOptions = {}): string => {
  const { fallbackLng, resources: res, defaultNS } = i18nInstance
  const language = options.lng ?? i18nInstance.language

  // Parse key to extract namespace and actual key
  let namespace = defaultNS
  let translationKey = key

  if (key.includes(':')) {
    const parts = key.split(':')
    namespace = parts[0]
    translationKey = parts[1]
  }

  // Helper function to get nested value from object using dot notation
  const getNestedValue = (
    obj: Record<string, unknown>,
    path: string
  ): string | undefined => {
    return path.split('.').reduce((current, key) => {
      return current &&
        typeof current === 'object' &&
        current !== null &&
        key in current
        ? (current as Record<string, unknown>)[key]
        : undefined
    }, obj as unknown) as string | undefined
  }

  // Try to get translation from current language
  let translation = getNestedValue(res[language]?.[namespace], translationKey)

  // Fallback to fallback language if not found
  if (translation === undefined && language !== fallbackLng) {
    translation = getNestedValue(res[fallbackLng]?.[namespace], translationKey)
  }

  // If still not found, fall back to defaultValue option, then return the key itself
  if (translation === undefined) {
    if (options.defaultValue !== undefined) {
      return String(options.defaultValue)
    }
    console.warn(`Translation missing for key: ${key}`)
    return key
  }

  // Handle interpolation
  if (typeof translation === 'string' && options) {
    return translation.replace(/\{\{(\w+)\}\}/g, (match, variable) => {
      return options[variable] !== undefined ? String(options[variable]) : match
    })
  }

  return String(translation)
}

// Change language function
const changeLanguage = (lng: string): void => {
  if (i18nInstance && getCompleteLanguages().includes(lng)) {
    i18nInstance.language = lng

    // Update localStorage
    try {
      const stored = safeStorageGetItem(
        localStorage,
        localStorageKey.settingGeneral,
        'i18n'
      )
      const parsed = stored ? JSON.parse(stored) : { state: {} }
      const parsedState =
        parsed &&
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.state === 'object' &&
        parsed.state !== null
          ? (parsed.state as { currentLanguage?: string })
          : {}
      const nextState = {
        ...parsedState,
        currentLanguage: lng,
      }
      safeStorageSetItem(
        localStorage,
        localStorageKey.settingGeneral,
        JSON.stringify({ ...parsed, state: nextState }),
        'i18n'
      )
    } catch (error) {
      console.error('Failed to save language preference:', error)
    }
  }
}

// Initialize i18n instance
const initI18n = (): I18nInstance => {
  const currentLanguage = getStoredLanguage()

  i18nInstance = {
    language: currentLanguage,
    fallbackLng: 'en',
    resources,
    namespaces,
    defaultNS: 'common',
    changeLanguage,
    t: translate,
  }

  return i18nInstance
}

// Initialize and export the i18n instance
export const i18n = initI18n()
