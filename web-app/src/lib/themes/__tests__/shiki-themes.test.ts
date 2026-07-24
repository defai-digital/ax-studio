import { describe, expect, it } from 'vitest'

import { axStudioDarkTheme } from '../shiki-theme-dark'
import { axStudioLightTheme } from '../shiki-theme-light'

type ThemeToken = NonNullable<typeof axStudioDarkTheme.settings>[number]

function hasTokenScope(token: ThemeToken, scope: string): boolean {
  return Array.isArray(token.scope)
    ? token.scope.includes(scope)
    : token.scope === scope
}

describe('AX Studio Shiki themes', () => {
  it('defines matching dark and light theme metadata', () => {
    expect(axStudioDarkTheme).toMatchObject({
      name: 'ax-studio-dark',
      type: 'dark',
    })
    expect(axStudioLightTheme).toMatchObject({
      name: 'ax-studio-light',
      type: 'light',
    })
  })

  it('provides editor colors and token color rules', () => {
    for (const theme of [axStudioDarkTheme, axStudioLightTheme]) {
      expect(theme.colors?.['editor.background']).toBeDefined()
      expect(theme.colors?.['editor.foreground']).toBeDefined()
      expect(theme.settings?.length).toBeGreaterThanOrEqual(20)
      expect(
        theme.settings?.some((token) => hasTokenScope(token, 'keyword'))
      ).toBe(true)
      expect(
        theme.settings?.some((token) => hasTokenScope(token, 'string'))
      ).toBe(true)
      expect(
        theme.settings?.some((token) =>
          hasTokenScope(token, 'variable.other.property')
        )
      ).toBe(true)
      expect(
        theme.settings?.some((token) =>
          hasTokenScope(token, 'support.function.builtin')
        )
      ).toBe(true)
    }
  })
})
