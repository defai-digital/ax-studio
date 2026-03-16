import { type ReactNode, memo, useMemo } from 'react'
import { AXMarkdown, axDefaultRehypePlugins } from '@/lib/markdown/renderer'
import type { MermaidErrorComponentProps } from 'streamdown'
import { cn, disableIndentedCodeBlockPlugin } from '@/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { MermaidError } from '@/components/MermaidError'
import { useTheme } from '@/hooks/useTheme'
import { PythonCodeBlock } from '@/components/ai-elements/PythonCodeBlock'
import { ArtifactBlock } from '@/components/ai-elements/ArtifactBlock'
import { RenderableCodeBlock } from '@/components/ai-elements/RenderableCodeBlock'
import type { ArtifactType } from '@/lib/artifact-harness'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Components = any

interface MarkdownProps {
  content: string
  className?: string
  components?: Components
  isUser?: boolean
  isStreaming?: boolean
  messageId?: string
  threadId?: string
}

/**
 * Fixes Mermaid syntax errors caused by unquoted square-bracket node labels
 * that contain characters the Mermaid parser cannot handle without quotes:
 *
 *   '  apostrophe   → A[Recipient's] breaks the parser
 *   () parentheses  → A[Setup (X3DH)] is treated as shape syntax
 *   <> angle bracks → A[<br/>text] confuses the tokeniser
 *   |  pipe         → A[foo|bar] is misread as an edge-label delimiter
 *
 * Any label containing one of those characters is wrapped in double quotes:
 *   A[Recipient's Device]          → A["Recipient's Device"]
 *   A[Setup (X3DH Key Exchange)]   → A["Setup (X3DH Key Exchange)"]
 *   A[<br/>Signal Protocol (E2E)]  → A["<br/>Signal Protocol (E2E)"]
 *
 * Skips labels that are already quoted (start with ") and labels that begin
 * with a Mermaid shape specifier ([ ( / \ >).
 * Only operates inside ```mermaid fences.
 */
function sanitizeMermaidFences(input: string): string {
  // Characters that break Mermaid's parser inside unquoted [ ] labels
  const UNSAFE = /['()|<>]/

  // Step 1: Close any mermaid fence that was truncated (model ran out of tokens
  // mid-response). Split on ```mermaid — if the last segment has no closing ```
  // the model stopped mid-fence; append one so the regex below can match it.
  let text = input
  const mermaidParts = text.split('```mermaid')
  if (mermaidParts.length > 1) {
    const last = mermaidParts[mermaidParts.length - 1]
    if (!last.includes('```')) {
      mermaidParts[mermaidParts.length - 1] = last.trimEnd() + '\n```'
      text = mermaidParts.join('```mermaid')
    }
  }

  // Step 2: Process every (now properly closed) mermaid fence.
  return text.replace(
    /(```mermaid\n)([\s\S]*?)(```)/g,
    (_full, open, body: string, close) => {
      let fixed = body.trimStart()

      // Fix 1: strip any nested ```mermaid fence that the model put inside the source
      fixed = fixed.replace(/^```mermaid\s*/i, '').replace(/```\s*$/, '').trimStart()

      // Fix 2: bare "flowchart" with no direction → add TD
      fixed = fixed.replace(/^(flowchart)\s*$/im, 'flowchart TD')

      // Fix 3: quote unquoted [ ] labels that contain special characters
      fixed = fixed
        .split('\n')
        .map((line) =>
          line.replace(
            /\[(?!["[/\\(>])([^\]\n"]+)\]/g,
            (_m, inner) => {
              if (!UNSAFE.test(inner)) return _m
              return `["${inner.replace(/"/g, '\\"')}"]`
            }
          )
        )
        .join('\n')

      // Fix 4: close unclosed class bodies in classDiagram (EOF_IN_STRUCT error).
      // Count unmatched { } braces and append the missing closing braces.
      const firstLine = fixed.trimStart().split('\n')[0] ?? ''
      if (/^classDiagram\b/i.test(firstLine)) {
        const opens = (fixed.match(/\{/g) ?? []).length
        const closes = (fixed.match(/\}/g) ?? []).length
        if (opens > closes) {
          fixed = fixed.trimEnd() + '\n' + '}'.repeat(opens - closes) + '\n'
        }
      }

      return open + fixed + close
    }
  )
}

// Cache for normalized LaTeX content
const latexCache = new Map<string, string>()

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

  // Cache the result (with size limit to prevent memory leaks)
  if (latexCache.size > 100) {
    const firstKey = latexCache.keys().next().value || ''
    latexCache.delete(firstKey)
  }
  latexCache.set(input, result)

  return result
}

/** Extract all text content from a HAST node. */
function extractHastText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.value === 'string') return n.value
  if (Array.isArray(n.children)) {
    return (n.children as unknown[]).map(extractHastText).join('')
  }
  return ''
}

const PYTHON_LANG_RE = /^(language-)?(python\d*|py\d*)$/i

const PYTHON_HEURISTICS = [
  /^import\s+\w/m,
  /^from\s+\w+\s+import/m,
  /^def\s+\w+\s*\(/m,
  /^class\s+\w+/m,
  /print\s*\(/,
]

/**
 * If a HAST pre node wraps a Python code block, returns the code text.
 * Returns null otherwise.
 *
 * Detection order:
 * 1. Explicit language tag matching python / py / python3 / py3 (case-insensitive)
 * 2. No language tag → fall back to content heuristics (import, def, class, print)
 */
function getPythonCode(preNode: unknown): string | null {
  if (!preNode || typeof preNode !== 'object') return null
  const node = preNode as Record<string, unknown>
  const children = node.children as unknown[] | undefined
  if (!Array.isArray(children) || children.length === 0) return null

  const codeEl = children[0] as Record<string, unknown>
  if (!codeEl || codeEl.tagName !== 'code') return null

  const props = codeEl.properties as Record<string, unknown> | undefined
  const classes = props?.className
  const code = extractHastText(codeEl)

  if (Array.isArray(classes) && classes.length > 0) {
    // Explicit language tag present — only match Python variants
    const isPython = classes.some(
      (c) => typeof c === 'string' && PYTHON_LANG_RE.test(c)
    )
    return isPython ? code : null
  }

  // No language tag — use heuristics to avoid false positives on generic blocks
  const looksLikePython = PYTHON_HEURISTICS.some((re) => re.test(code))
  return looksLikePython ? code : null
}

const ARTIFACT_LANG_RE = /^language-artifact-(html|react|svg|chartjs|vega)$/i

// Plain language classes that can be promoted to artifacts via the Render button
// Maps Streamdown class name → ArtifactType
const RENDERABLE_LANG_MAP: Record<string, ArtifactType> = {
  'language-html': 'html',
  'language-jsx': 'react',
  'language-tsx': 'react',
  'language-react': 'react',
  'language-svg': 'svg',
}

/**
 * If a HAST pre node wraps an artifact code block (explicit artifact-* fence,
 * or a full HTML document in a plain ```html block), returns the type and source.
 * Returns null otherwise.
 */
function getArtifactInfo(preNode: unknown): { type: ArtifactType; source: string } | null {
  if (!preNode || typeof preNode !== 'object') return null
  const node = preNode as Record<string, unknown>
  const children = node.children as unknown[] | undefined
  if (!Array.isArray(children) || children.length === 0) return null

  const codeEl = children[0] as Record<string, unknown>
  if (!codeEl || codeEl.tagName !== 'code') return null

  const props = codeEl.properties as Record<string, unknown> | undefined
  const classes = props?.className
  if (!Array.isArray(classes)) return null

  const strClasses = classes.filter((c): c is string => typeof c === 'string')

  // 1. Explicit artifact-* fence
  const match = strClasses.map((c) => ARTIFACT_LANG_RE.exec(c)).find(Boolean)
  if (match) {
    return { type: match[1].toLowerCase() as ArtifactType, source: extractHastText(codeEl) }
  }

  // 2. Auto-detect full HTML documents in plain ```html blocks
  const isHtml = strClasses.some((c) => c === 'language-html')
  if (isHtml) {
    const source = extractHastText(codeEl)
    if (/^<!DOCTYPE\s+html|^<html/i.test(source.trim())) {
      return { type: 'html', source }
    }
  }

  return null
}

/**
 * If a HAST pre node wraps a plain html/jsx/tsx/svg block (not already an
 * artifact), returns the type and source so a Render button can be shown.
 * Returns null if it's already handled by getArtifactInfo or is not renderable.
 */
function getRenderableInfo(preNode: unknown): { type: ArtifactType; source: string } | null {
  if (!preNode || typeof preNode !== 'object') return null
  const node = preNode as Record<string, unknown>
  const children = node.children as unknown[] | undefined
  if (!Array.isArray(children) || children.length === 0) return null

  const codeEl = children[0] as Record<string, unknown>
  if (!codeEl || codeEl.tagName !== 'code') return null

  const props = codeEl.properties as Record<string, unknown> | undefined
  const classes = props?.className
  if (!Array.isArray(classes)) return null

  const strClasses = classes.filter((c): c is string => typeof c === 'string')

  for (const cls of strClasses) {
    const type = RENDERABLE_LANG_MAP[cls]
    if (type) {
      return { type, source: extractHastText(codeEl) }
    }
  }
  return null
}

function RenderMarkdownComponent({
  content,
  className,
  isUser,
  isStreaming,
  components,
  messageId,
  threadId,
}: MarkdownProps) {
  const { isDark } = useTheme()
  const mermaidTheme = isDark ? 'dark' : 'default'

  // Memoize the normalized content to avoid reprocessing on every render
  const normalizedContent = useMemo(
    () => sanitizeMermaidFences(normalizeLatex(content)),
    [content]
  )

  /**
   * Custom `pre` component:
   * - For Python code blocks in assistant messages (not streaming): wraps with
   *   PythonCodeBlock which adds a Run button + execution results.
   * - All other cases: return children unchanged (same as Streamdown default).
   *
   * Streamdown passes `passNode: true` so we receive the HAST pre node as `node`.
   * The `children` prop already holds the fully syntax-highlighted code block JSX
   * rendered by Streamdown's default `code` component (jt).
   */
  const preOverride = useMemo(
    () =>
      ({ node, children }: { node?: unknown; children?: ReactNode }) => {
        if (!isUser && !isStreaming) {
          // 1. Explicit artifact-* fences + auto-detected full HTML docs
          const artifactInfo = getArtifactInfo(node)
          if (artifactInfo !== null) {
            return (
              <ArtifactBlock
                type={artifactInfo.type}
                source={artifactInfo.source}
                threadId={threadId ?? messageId}
              >
                {children}
              </ArtifactBlock>
            )
          }

          // 2. Plain html/jsx/tsx/svg blocks — show a Render button on hover
          const renderableInfo = getRenderableInfo(node)
          if (renderableInfo !== null) {
            return (
              <RenderableCodeBlock
                type={renderableInfo.type}
                source={renderableInfo.source}
                threadId={threadId ?? messageId}
              >
                {children}
              </RenderableCodeBlock>
            )
          }

          // 3. Python blocks
          const pythonCode = getPythonCode(node)
          if (pythonCode !== null) {
            return (
              <PythonCodeBlock code={pythonCode} threadId={threadId ?? messageId}>{children}</PythonCodeBlock>
            )
          }
        }
        return <>{children}</>
      },
    [isUser, isStreaming, threadId, messageId]
  )

  // Merge our pre override with any caller-supplied components.
  // Caller components take precedence (spread after).
  const mergedComponents = useMemo(
    () => ({ pre: preOverride, ...components }),
    [preOverride, components]
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
          enabled: false,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code: code as any,
          mermaid: mermaid,
          cjk: cjk,
        }}
        controls={{
          mermaid: {
            fullscreen: false,
          },
        }}
        mermaid={{
          config: { theme: mermaidTheme },
          errorComponent: messageId
            ? (props: MermaidErrorComponentProps) => <MermaidError messageId={messageId} {...props} />
            : undefined,
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
    prevProps.isStreaming === nextProps.isStreaming
)
