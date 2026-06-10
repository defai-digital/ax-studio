import { describe, expect, it } from 'vitest'

import { axStudioDarkTheme } from '../shiki-theme-dark'
import { axStudioLightTheme } from '../shiki-theme-light'

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
      expect(theme.tokenColors).toHaveLength(13)
      expect(theme.tokenColors?.some((token) =>
        Array.isArray(token.scope)
          ? token.scope.includes('keyword')
          : token.scope === 'keyword',
      )).toBe(true)
      expect(theme.tokenColors?.some((token) =>
        Array.isArray(token.scope)
          ? token.scope.includes('string')
          : token.scope === 'string',
      )).toBe(true)
    }
  })
})
