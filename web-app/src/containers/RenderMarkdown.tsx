import { type ComponentProps, type ReactNode, isValidElement, memo, useMemo, useCallback } from 'react'
import { AXMarkdown, axDefaultRehypePlugins } from '@/lib/markdown/renderer'
import { cn, disableIndentedCodeBlockPlugin } from '@/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { CitationChip } from '@/components/citations/CitationChip'
import { useCitations } from '@/hooks/citations/use-citations'

/** Recursively extract text from React children (handles Streamdown's animated <span> wraps). */
function extractTextFromNode(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromNode).join('')
  if (isValidElement<{ children?: ReactNode }>(node) && node.props.children) {
    return extractTextFromNode(node.props.children)
  }
  return ''
}
import 'katex/dist/katex.min.css'

type MarkdownComponents = ComponentProps<typeof AXMarkdown>['components']
type MarkdownAnchorProps = {
  children?: ReactNode
  href?: string
  node?: unknown
} & Record<string, unknown>

interface MarkdownProps {
  content: string
  className?: string
  components?: MarkdownComponents
  isUser?: boolean
  isStreaming?: boolean
  messageId?: string
  threadId?: string
}

// Cache for normalized LaTeX content
const latexCache = new Map<string, string>()
const LATEX_CACHE_MAX = 50

/**
 * Optimized preprocessor: normalize LaTeX fragments into $ / $$.
 * Uses caching to avoid reprocessing the same content.
 */
const normalizeLatex = (input: string): string => {
  // Check cache first
  if (latexCache.has(input)) {
    return latexCache.get(input)!
  }

  const segments = input.split(/(```[\s\S]*?```|`[^`]*`|<[^>]+>)/g)

  const result = segments
    .map((segment) => {
      if (!segment) return ''

      // Skip code blocks, inline code, html tags
      if (/^```[\s\S]*```$/.test(segment)) return segment
      if (/^`[^`]*`$/.test(segment)) return segment
      if (/^<[^>]+>$/.test(segment)) return segment

      let s = segment

      // --- Display math: \[...\] surrounded by newlines
      s = s.replace(
        /(^|\n)\\\[\s*\n([\s\S]*?)\n\s*\\\](?=\n|$)/g,
        (_, pre, inner) => `${pre}$$\n${inner.trim()}\n$$`
      )

      // --- Inline math: space \( ... \)
      s = s.replace(
        /(^|[^$\\])\\\((.+?)\\\)(?=[^$\\]|$)/g,
        (_, pre, inner) => `${pre}$${inner.trim()}$`
      )

      // --- Escape $<number> to prevent Markdown from treating it as LaTeX
      // Example: "$1" → "\$1"
      s = s.replace(/\$(\d+)/g, (_, num) => '\\$' + num)

      return s
    })
    .join('')

  // Skip caching for very long inputs (streaming chunks) — they won't be reused
  if (input.length > 5000) return result

  if (latexCache.size >= LATEX_CACHE_MAX) {
    const firstKey = latexCache.keys().next().value
    if (firstKey !== undefined) latexCache.delete(firstKey)
  }
  latexCache.set(input, result)

  return result
}

function RenderMarkdownComponent({
  content,
  className,
  isUser,
  isStreaming: _isStreaming,
  components,
  messageId,
  threadId: _threadId,
}: MarkdownProps) {
  // Memoize the normalized content to avoid reprocessing on every render
  const normalizedContent = useMemo(
    () => normalizeLatex(content),
    [content]
  )

  /**
   * Custom `pre` component:
   * - All cases: return children unchanged (same as Streamdown default).
   *
   * Streamdown passes `passNode: true` so we receive the HAST pre node as `node`.
   */
  const preOverride = useMemo(
    () =>
      ({ children }: { node?: unknown; children?: ReactNode }) => {
        return <>{children}</>
      },
    []
  )

  // Citation-aware anchor override: renders [N] links as CitationChip when sources exist
  const citationData = useCitations((s) => messageId ? s.getCitations(messageId) : undefined)

  const anchorOverride = useCallback(
    ({ children, href, node: _node, ...props }: MarkdownAnchorProps) => {
      // Extract text from children (Streamdown's animated mode wraps text in <span>)
      const text = extractTextFromNode(children)
      const match = text.match(/^\[(\d+)\]$/)

      if (match && citationData?.sources) {
        const index = parseInt(match[1], 10) - 1
        const source = citationData.sources[index]
        if (source) {
          return <CitationChip number={index + 1} source={source} />
        }
      }

      // Default anchor rendering — spread props first so our explicit attrs win
      return <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    [citationData]
  )

  // Merge our pre override with any caller-supplied components.
  // Caller components take precedence (spread after).
  const mergedComponents = useMemo(
    () => ({ pre: preOverride, a: anchorOverride, ...components }),
    [preOverride, anchorOverride, components]
  )

  // Render the markdown content
  return (
    <div
      className={cn(
        'markdown break-words select-text overflow-hidden min-w-0 text-[14px] leading-relaxed',
        isUser && 'is-user',
        className
      )}
    >
      <AXMarkdown
        animated={true}
        linkSafety={{
          enabled: true,
        }}
        className={cn(
          'w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1.5 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_strong]:font-semibold',
          className
        )}
        remarkPlugins={[remarkGfm, remarkMath, disableIndentedCodeBlockPlugin]}
        rehypePlugins={[
          rehypeKatex,
          axDefaultRehypePlugins.harden,
        ]}
        components={mergedComponents}
        plugins={{
          code: code as NonNullable<ComponentProps<typeof AXMarkdown>['plugins']>['code'],
          cjk: cjk,
        }}
      >
        {normalizedContent}
      </AXMarkdown>
    </div>
  )
}

export const RenderMarkdown = memo(
  RenderMarkdownComponent,
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.threadId === nextProps.threadId &&
    prevProps.isUser === nextProps.isUser &&
    prevProps.className === nextProps.className &&
    prevProps.components === nextProps.components
)
