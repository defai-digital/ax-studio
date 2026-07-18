import { describe, it, expect, vi } from 'vitest'
import { i18n } from '../setup'

describe('i18n setup', () => {
  it('always initializes with English as language and fallback', () => {
    expect(i18n.language).toBe('en')
    expect(i18n.fallbackLng).toBe('en')
    expect(i18n.defaultNS).toBe('common')
  })

  it('loads the english resources and namespaces', () => {
    expect(i18n.resources.en).toBeDefined()
    expect(i18n.namespaces).toContain('common')
  })

  it('translates keys with namespace resolution', () => {
    expect(i18n.t('common:settings')).toBe('Settings')
    // Falls back to the default namespace when no namespace is given
    expect(i18n.t('settings')).toBe('Settings')
  })

  it('interpolates variables', () => {
    expect(i18n.t('common:loginWith', { provider: 'GitHub' })).toBe(
      'Log In With GitHub'
    )
  })

  it('returns defaultValue for missing keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(i18n.t('common:nonExistentKey', { defaultValue: 'Fallback' })).toBe(
      'Fallback'
    )

    warn.mockRestore()
  })

  it('falls back for inherited translation keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(i18n.t('__proto__')).toBe('__proto__')
    expect(i18n.t('common:constructor')).toBe('common:constructor')

    warn.mockRestore()
  })
})
