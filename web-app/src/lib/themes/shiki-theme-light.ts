import type { ThemeRegistrationRaw } from 'shiki'

/**
 * Custom light Shiki theme for the redesigned UI.
 * Based on the reference design's code block color tokens.
 */
export const axStudioLightTheme: ThemeRegistrationRaw = {
  name: 'ax-studio-light',
  type: 'light',
  colors: {
    'editor.background': '#fafafa',
    'editor.foreground': '#24292e',
    'editorLineNumber.foreground': '#a1a1aa',
    'editorLineNumber.activeForeground': '#24292e',
  },
  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: {
        foreground: '#59636e',
        fontStyle: 'italic',
      },
    },
    {
      scope: ['keyword', 'storage.type', 'storage.modifier'],
      settings: {
        foreground: '#8b5cf6',
      },
    },
    {
      scope: ['string', 'string.quoted'],
      settings: {
        foreground: '#16a34a',
      },
    },
    {
      scope: ['constant.numeric'],
      settings: {
        foreground: '#ea580c',
      },
    },
    {
      scope: ['entity.name.function', 'support.function'],
      settings: {
        foreground: '#4f46e5',
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
        foreground: '#0891b2',
      },
    },
    {
      scope: ['variable', 'variable.other'],
      settings: {
        foreground: '#24292e',
      },
    },
    {
      scope: ['entity.name.tag'],
      settings: {
        foreground: '#dc2626',
      },
    },
    {
      scope: ['entity.other.attribute-name'],
      settings: {
        foreground: '#ea580c',
      },
    },
    {
      scope: ['constant.language'],
      settings: {
        foreground: '#2563eb',
      },
    },
    {
      scope: ['meta.embedded', 'source.groovy.embedded'],
      settings: {
        foreground: '#24292e',
      },
    },
    {
      scope: ['punctuation'],
      settings: {
        foreground: '#64748b',
      },
    },
    {
      scope: ['keyword.operator'],
      settings: {
        foreground: '#4f46e5',
      },
    },
    {
      scope: [
        'variable.parameter',
        'meta.function.parameters variable',
        'meta.parameters variable',
      ],
      settings: {
        foreground: '#be123c',
      },
    },
    {
      scope: [
        'variable.other.property',
        'support.type.property-name',
        'meta.object-literal.key',
        'meta.mapping.key',
      ],
      settings: {
        foreground: '#b45309',
      },
    },
    {
      scope: [
        'support.function.builtin',
        'support.variable',
        'variable.language',
        'entity.name.namespace',
      ],
      settings: {
        foreground: '#0369a1',
      },
    },
    {
      scope: [
        'constant.other',
        'constant.character',
        'constant.character.escape',
      ],
      settings: {
        foreground: '#c2410c',
      },
    },
    {
      scope: [
        'entity.name.function.decorator',
        'meta.decorator',
        'punctuation.decorator',
      ],
      settings: {
        foreground: '#7c3aed',
      },
    },
    {
      scope: ['string.regexp', 'constant.other.regex'],
      settings: {
        foreground: '#be123c',
      },
    },
    {
      scope: [
        'markup.heading',
        'markup.bold',
        'entity.name.section',
        'punctuation.definition.heading',
      ],
      settings: {
        foreground: '#4338ca',
      },
    },
  ],
}
