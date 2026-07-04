import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ShikiTransformer,
} from 'shiki'
import { axStudioDarkTheme } from '@/lib/themes/shiki-theme-dark'
import { axStudioLightTheme } from '@/lib/themes/shiki-theme-light'

export type CodeBlockLanguage = BundledLanguage

let highlighterPromise: Promise<Highlighter> | null = null
const loadedLanguages = new Set<string>()

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [axStudioLightTheme, axStudioDarkTheme],
    langs: [],
  })
  return highlighterPromise
}

const MAX_CACHE_SIZE = 200
const htmlCache = new Map<string, [string, string]>()
const pendingHighlights = new Map<string, Promise<[string, string]>>()

function cacheHighlight(cacheKey: string, result: [string, string]) {
  while (htmlCache.size >= MAX_CACHE_SIZE) {
    const firstKey = htmlCache.keys().next().value
    if (firstKey === undefined || firstKey === cacheKey) break
    htmlCache.delete(firstKey)
  }
  htmlCache.set(cacheKey, result)
}

const lineNumberTransformer: ShikiTransformer = {
  name: 'line-numbers',
  line(node, line) {
    node.children.unshift({
      type: 'element',
      tagName: 'span',
      properties: {
        className: [
          'inline-block',
          'min-w-10',
          'mr-4',
          'text-right',
          'text-muted-foreground',
        ],
      },
      children: [{ type: 'text', value: String(line) }],
    })
  },
}

export async function highlightCode(
  code: string,
  language: CodeBlockLanguage,
  showLineNumbers = false
): Promise<[string, string]> {
  const cacheKey = `${language}:${showLineNumbers ? '1' : '0'}:${code}`
  const cached = htmlCache.get(cacheKey)
  if (cached) return cached

  const pending = pendingHighlights.get(cacheKey)
  if (pending) return pending

  const promise = (async (): Promise<[string, string]> => {
    const transformers: ShikiTransformer[] = showLineNumbers
      ? [lineNumberTransformer]
      : []

    const highlighter = await getHighlighter()
    if (!loadedLanguages.has(language)) {
      await highlighter.loadLanguage(language)
      loadedLanguages.add(language)
    }

    const existing = htmlCache.get(cacheKey)
    if (existing) return existing

    const result: [string, string] = [
      highlighter.codeToHtml(code, {
        lang: language,
        theme: 'ax-studio-light',
        transformers,
      }),
      highlighter.codeToHtml(code, {
        lang: language,
        theme: 'ax-studio-dark',
        transformers,
      }),
    ]

    cacheHighlight(cacheKey, result)
    return result
  })()

  pendingHighlights.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    pendingHighlights.delete(cacheKey)
  }
}
