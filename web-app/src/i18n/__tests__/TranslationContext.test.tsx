import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationContext } from '../context'
import { TranslationProvider } from '../TranslationContext'

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string, options?: Record<string, unknown>) => {
    return `${key}:${String(options?.lng ?? 'none')}`
  }),
}))

vi.mock('../setup', () => ({
  i18n: {
    language: 'en',
    fallbackLng: 'en',
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
        <span data-testid="translation">{t('common:newChat', options)}</span>
      )}
    </TranslationContext.Consumer>
  )
}

describe('TranslationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates translation calls to the i18n instance', () => {
    render(
      <TranslationProvider>
        <TranslationConsumer />
      </TranslationProvider>
    )

    expect(screen.getByTestId('translation').textContent).toBe(
      'common:newChat:none'
    )
    expect(mocks.t).toHaveBeenLastCalledWith('common:newChat', {
      defaultValue: 'New Chat',
    })
  })

  it('passes explicit language overrides through to the i18n instance', () => {
    render(
      <TranslationProvider>
        <TranslationConsumer options={{ lng: 'en' }} />
      </TranslationProvider>
    )

    expect(screen.getByTestId('translation').textContent).toBe(
      'common:newChat:en'
    )
    expect(mocks.t).toHaveBeenLastCalledWith('common:newChat', { lng: 'en' })
  })
})
