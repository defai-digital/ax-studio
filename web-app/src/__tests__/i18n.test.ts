import { describe, it, expect, vi } from 'vitest'

// Mock the dependencies
vi.mock('@/i18n/setup', () => ({
  i18n: { t: vi.fn(), init: vi.fn() },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: vi.fn(() => ({ t: vi.fn() })),
}))

vi.mock('@/i18n/hooks', () => ({
  useAppTranslation: vi.fn(() => ({ t: vi.fn() })),
}))

vi.mock('@/i18n/TranslationContext', () => ({
  TranslationProvider: vi.fn(({ children }) => children),
}))

describe('i18n module', () => {
  it('should re-export i18n from i18n/setup', async () => {
    const i18nModule = await import('../i18n')
    expect(i18nModule.i18n).toBeDefined()
  })

  it('should re-export useTranslation', async () => {
    const i18nModule = await import('../i18n')
    expect(i18nModule.useTranslation).toBeDefined()
    expect(typeof i18nModule.useTranslation).toBe('function')
  })

  it('should re-export useAppTranslation', async () => {
    const i18nModule = await import('../i18n')
    expect(i18nModule.useAppTranslation).toBeDefined()
    expect(typeof i18nModule.useAppTranslation).toBe('function')
  })

  it('should re-export TranslationProvider', async () => {
    const i18nModule = await import('../i18n')
    expect(i18nModule.TranslationProvider).toBeDefined()
    expect(typeof i18nModule.TranslationProvider).toBe('function')
  })

  it('should export all expected functions', async () => {
    const i18nModule = await import('../i18n')
    const expectedExports = [
      'i18n',
      'useTranslation',
      'useAppTranslation',
      'TranslationProvider',
    ]

    expectedExports.forEach((exportName) => {
      expect(i18nModule[exportName]).toBeDefined()
    })
  })
})
