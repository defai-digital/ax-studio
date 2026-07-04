import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '../context'
import { TranslationProvider } from '../TranslationContext'

const mocks = vi.hoisted(() => ({
  currentLanguage: 'en',
  changeLanguage: vi.fn(),
  t: vi.fn((key: string, options?: Record<string, unknown>) => {
    return `${key}:${String(options?.lng ?? 'none')}`
  }),
}))

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    currentLanguage: mocks.currentLanguage,
  }),
}))

vi.mock('../setup', () => ({
  default: {
    changeLanguage: mocks.changeLanguage,
    t: mocks.t,
  },
}))

function TranslationConsumer({
  options = { defaultValue: 'New Chat' },
}: {
  options?: Record<string, unknown>
}) {
  return (
    <TranslationContext.Consumer>
      {({ t }) => (
        <span data-testid="translation">
          {t('common:newChat', options)}
        </span>
      )}
    </TranslationContext.Consumer>
  )
}

describe('TranslationProvider', () => {
  beforeEach(() => {
    mocks.currentLanguage = 'en'
    vi.clearAllMocks()
  })

  it('rebinds translations when the selected language changes', () => {
    const { rerender } = render(
      <TranslationProvider>
        <TranslationConsumer />
      </TranslationProvider>
    )

    expect(screen.getByTestId('translation').textContent).toBe(
      'common:newChat:en'
    )
    expect(mocks.changeLanguage).toHaveBeenLastCalledWith('en')
    expect(mocks.t).toHaveBeenLastCalledWith('common:newChat', {
      lng: 'en',
      defaultValue: 'New Chat',
    })

    mocks.currentLanguage = 'fr'

    rerender(
      <TranslationProvider>
        <TranslationConsumer />
      </TranslationProvider>
    )

    expect(screen.getByTestId('translation').textContent).toBe(
      'common:newChat:fr'
    )
    expect(mocks.changeLanguage).toHaveBeenLastCalledWith('fr')
    expect(mocks.t).toHaveBeenLastCalledWith('common:newChat', {
      lng: 'fr',
      defaultValue: 'New Chat',
    })
  })

  it('uses explicit language overrides without treating undefined as an override', () => {
    const { rerender } = render(
      <TranslationProvider>
        <TranslationConsumer options={{ lng: 'zh-TW' }} />
      </TranslationProvider>
    )

    expect(screen.getByTestId('translation').textContent).toBe(
      'common:newChat:zh-TW'
    )

    rerender(
      <TranslationProvider>
        <TranslationConsumer options={{ lng: undefined }} />
      </TranslationProvider>
    )

    expect(screen.getByTestId('translation').textContent).toBe(
      'common:newChat:en'
    )
  })
})
