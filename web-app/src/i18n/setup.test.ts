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

// Import after mocking
import { getStoredLanguage } from './setup'

describe('getStoredLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return language from valid stored settings', () => {
    const validData = {
      state: {
        currentLanguage: 'id'
      }
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(validData))

    const result = getStoredLanguage()

    expect(result).toBe('id')
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith(localStorageKey.settingGeneral)
  })

  it('should return "en" when no stored value exists', () => {
    mockLocalStorage.getItem.mockReturnValue(null)

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" when stored value is empty string', () => {
    mockLocalStorage.getItem.mockReturnValue('')

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" when parsed data is missing state property', () => {
    const invalidData = { version: '1.0' }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" when state is not an object', () => {
    const invalidData = { state: 'invalid' }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" when state.currentLanguage is missing', () => {
    const invalidData = {
      state: {
        spellCheckChatInput: true
      }
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" when currentLanguage is not a string', () => {
    const invalidData = {
      state: {
        currentLanguage: 123
      }
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" when JSON parsing fails', () => {
    mockLocalStorage.getItem.mockReturnValue('invalid json')

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })

  it('should return "en" for various invalid structures', () => {
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

    invalidCases.forEach((invalidData) => {
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))
      const result = getStoredLanguage()
      expect(result).toBe('en')
    })
  })

  it('should handle deeply nested invalid structures', () => {
    const invalidData = {
      state: {
        currentLanguage: 'en',
        nested: {
          invalid: {
            structure: true
          }
        }
      }
    }
    // This should still work since the valid properties are present
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(invalidData))

    const result = getStoredLanguage()

    expect(result).toBe('en')
  })
})