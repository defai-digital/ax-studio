import type { ThemeRegistrationRaw } from 'shiki'

/**
 * Custom dark Shiki theme for the redesigned UI.
 * Token colors match the reference design's code block spec.
 */
export const axStudioDarkTheme: ThemeRegistrationRaw = {
  name: 'ax-studio-dark',
  type: 'dark',
  settings: [],
  colors: {
    'editor.background': '#09090b',
    'editor.foreground': '#e2e8f0',
    'editorLineNumber.foreground': '#52525b',
    'editorLineNumber.activeForeground': '#a1a1aa',
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: {
        foreground: '#546e7a',
        fontStyle: 'italic',
      },
    },
    {
      scope: ['keyword', 'storage.type', 'storage.modifier'],
      settings: {
        foreground: '#c792ea',
      },
    },
    {
      scope: ['string', 'string.quoted'],
      settings: {
        foreground: '#c3e88d',
      },
    },
    {
      scope: ['constant.numeric'],
      settings: {
        foreground: '#f78c6c',
      },
    },
    {
      scope: ['entity.name.function', 'support.function'],
      settings: {
        foreground: '#82aaff',
      },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'support.type',
        'support.class',
      ],
      settings: {
        foreground: '#ffcb6b',
      },
    },
    {
      scope: ['variable', 'variable.other'],
      settings: {
        foreground: '#eeffff',
      },
    },
    {
      scope: ['entity.name.tag'],
      settings: {
        foreground: '#f07178',
      },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: {
        foreground: '#ffcb6b',
      },
    },
    {
      scope: ['constant.language'],
      settings: {
        foreground: '#89ddff',
      },
    },
    {
      scope: ['meta.embedded', 'source.groovy.embedded'],
      settings: {
        foreground: '#eeffff',
      },
    },
    {
      scope: ['punctuation'],
      settings: {
        foreground: '#89ddff',
      },
    },
    {
      scope: ['keyword.operator'],
      settings: {
        foreground: '#89ddff',
      },
    },
  ],
}
