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
        Object.prototype.hasOwnProperty.call(current, key)
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

// Initialize i18n instance
const initI18n = (): I18nInstance => {
  i18nInstance = {
    language: 'en',
    fallbackLng: 'en',
    resources,
    namespaces,
    defaultNS: 'common',
    t: translate,
  }

  return i18nInstance
}

// Initialize and export the i18n instance
export const i18n = initI18n()
