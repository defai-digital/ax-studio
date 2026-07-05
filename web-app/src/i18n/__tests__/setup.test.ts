import { describe, it, expect, beforeEach, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

async function loadI18n() {
  vi.resetModules()
  return (await import('../setup')).i18n
}

describe('getStoredLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with complete language from valid stored settings', async () => {
    const validData = {
      state: {
        currentLanguage: 'en',
      },
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(validData))

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith(
      localStorageKey.settingGeneral
    )
  })

  it('should initialize with "en" for stored languages that are incomplete or unsupported', async () => {
    mockLocalStorage.getItem.mockReturnValue(
      JSON.stringify({
        state: {
          currentLanguage: 'ja',
        },
      })
    )

    expect((await loadI18n()).language).toBe('en')
  })

  it('should ignore language changes to incomplete or unsupported packs', async () => {
    mockLocalStorage.getItem.mockReturnValue(null)
    const i18n = await loadI18n()

    i18n.changeLanguage('ja')

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when no stored value exists', async () => {
    mockLocalStorage.getItem.mockReturnValue(null)

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when stored value is empty string', async () => {
    mockLocalStorage.getItem.mockReturnValue('')

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when parsed data is missing state property', async () => {
    const invalidData = { version: '1.0' }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when state is not an object', async () => {
    const invalidData = { state: 'invalid' }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when state.currentLanguage is missing', async () => {
    const invalidData = {
      state: {
        spellCheckChatInput: true,
      },
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when currentLanguage is not a string', async () => {
    const invalidData = {
      state: {
        currentLanguage: 123,
      },
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" when JSON parsing fails', async () => {
    mockLocalStorage.getItem.mockReturnValue('invalid json')

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })

  it('should initialize with "en" for various invalid structures', async () => {
    const invalidCases = [
      null,
      undefined,
      [],
      'string',
      42,
      { state: null },
      { state: {} },
      { state: { currentLanguage: null } },
      { state: { currentLanguage: [] } },
    ]

    for (const invalidData of invalidCases) {
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))
      expect((await loadI18n()).language).toBe('en')
    }
  })

  it('should handle deeply nested invalid structures', async () => {
    const invalidData = {
      state: {
        currentLanguage: 'en',
        nested: {
          invalid: {
            structure: true,
          },
        },
      },
    }
    // This should still work since the valid properties are present
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const i18n = await loadI18n()

    expect(i18n.language).toBe('en')
  })
})
