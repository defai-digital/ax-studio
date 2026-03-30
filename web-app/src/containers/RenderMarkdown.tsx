import { type ReactNode, memo, useMemo, useState, useEffect, useRef } from 'react'
import { AXMarkdown, axDefaultRehypePlugins } from '@/lib/markdown/renderer'
import { cn, disableIndentedCodeBlockPlugin } from '@/lib/utils'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import mermaidLib from 'mermaid'
import DOMPurify from 'dompurify'
import { useTheme } from '@/hooks/useTheme'
import { PythonCodeBlock } from '@/components/ai-elements/PythonCodeBlock'
import { ArtifactBlock } from '@/components/ai-elements/ArtifactBlock'
import { RenderableCodeBlock } from '@/components/ai-elements/RenderableCodeBlock'
import { MermaidError } from '@/components/MermaidError'
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
    /(```mermaid[^\n]*\n)([\s\S]*?)(```)/g,
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
            /\[(?!["[/\\(>|])([^\]\n"]+)\]/g,
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

      // Fix 5: strip unsupported class/classDef/style blocks from erDiagram.
      // These cause "got 'BLOCK_START'" parse errors — only entity definitions
      // and relationship lines are valid inside an erDiagram.
      if (/^erDiagram\b/i.test(firstLine)) {
        fixed = fixed.replace(/^[ \t]*(?:class|classDef|style)\s+\S[^{]*\{[^}]*\}/gm, '')

        // Fix 8: strip %% comments inside entity definitions (indented lines).
        // ER diagrams don't support %% comments inside entity blocks —
        // Mermaid throws "expecting ATTRIBUTE_WORD, got COMMENT".
        // Top-level (column-0) comments are preserved.
        fixed = fixed.replace(/^([ \t]+)%%.*$/gm, '')
      }

      // Fix 6: strip inline parenthesised text from mindmap node labels.
      // In Mermaid mindmap, `(text)` is shape syntax, so "CNN (Convolutional)"
      // causes a parse error. Keep the inner text, drop the parens.
      if (/^mindmap\b/i.test(firstLine)) {
        fixed = fixed
          .split('\n')
          .map((line) => {
            const trimmed = line.trimStart()
            // Leave empty lines, comments, and lines that intentionally start
            // with a shape specifier (e.g. `((root))`, `[rect]`, `{{cloud}}`)
            if (!trimmed || trimmed.startsWith('%%') || /^[([{}]/.test(trimmed)) return line
            // Remove " (inner text)" patterns — keep the inner text, drop parens
            return line.replace(/\s+\(([^)\n]*)\)/g, (_, inner) => inner ? ` ${inner}` : '')
          })
          .join('\n')
      }

      // Fix 7: flatten composite state blocks in stateDiagram to prevent
      // "would create a cycle" errors. When the AI writes:
      //   state Processing { [*] --> SuccessState }
      // and SuccessState also appears at the outer level, Mermaid tries to
      // make SuccessState a child of Processing — which creates a cycle.
      // Strip the `state X { }` wrapper and promote inner lines to the
      // outer level. Run in a loop to handle nested composite states.
      if (/^stateDiagram(?:-v2)?\b/i.test(firstLine)) {
        // Fix 9: unquote state identifiers in transitions.
        // Mermaid expects bare identifiers: `Placed --> Confirmed`
        // LLMs generate: `"Placed" --> "Confirmed"` which fails.
        // Preserve quoted labels after `:` (e.g. State1 : "Label text").
        fixed = fixed.replace(/"([A-Za-z_]\w*)"/g, (match, id, offset) => {
          const before = fixed.slice(Math.max(0, offset - 3), offset)
          if (/:\s*$/.test(before)) return match // preserve state description labels
          return id
        })

        let prev = ''
        while (fixed !== prev) {
          prev = fixed
          fixed = fixed.replace(/^[ \t]*state\s+[^\n{]+\{[ \t]*\n([\s\S]*?)\n[ \t]*\}/gm, '$1')
        }
      }

      // Fix 10: collapse consecutive blank lines (all diagram types).
      // Previous fixes may leave behind empty lines; 3+ consecutive
      // newlines can cause spurious parse errors in some diagram types.
      fixed = fixed.replace(/\n{3,}/g, '\n\n')

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

/** Returns true if the HAST pre node wraps a mermaid code block. */
function isMermaidNode(preNode: unknown): boolean {
  if (!preNode || typeof preNode !== 'object') return false
  const node = preNode as Record<string, unknown>
  const children = node.children as unknown[] | undefined
  if (!Array.isArray(children) || children.length === 0) return false

  const codeEl = children[0] as Record<string, unknown>
  if (!codeEl || codeEl.tagName !== 'code') return false

  const props = codeEl.properties as Record<string, unknown> | undefined
  const classes = props?.className
  if (!Array.isArray(classes)) return false

  return classes.some(
    (c) => typeof c === 'string' && /^language-mermaid$/i.test(c)
  )
}

/**
 * Extract all mermaid diagram sources from a sanitized markdown string.
 * Returns them in document order so they can be matched to HAST nodes by index.
 * We use the raw string rather than HAST text extraction because Shiki's
 * line-span format can strip newlines from the HAST, breaking line-sensitive
 * parsers (Gantt, mindmap, sequence, etc.).
 *
 * The fence pattern is lenient: allows optional trailing content on the
 * opening line (e.g. "```mermaid " with a trailing space).
 */
function extractMermaidBlocks(content: string): string[] {
  const blocks: string[] = []
  // [^\n]* allows trailing spaces or other chars after "mermaid" on the fence line
  const regex = /```mermaid[^\n]*\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(content)) !== null) {
    const source = match[1].trim()
    if (source) blocks.push(source)
  }
  return blocks
}

/** Renders a mermaid diagram directly via mermaidLib, bypassing Streamdown's plugin.
 *  Uses a 2-attempt error-driven retry pipeline:
 *    Attempt 1: render source as-is
 *    Attempt 2: apply targeted fixes based on the error message pattern, re-render
 */
function MermaidDiagram({ source, theme }: { source: string; theme: string }) {
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    mermaidLib.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme as never })
    const renderWithRetry = async () => {
      const id = `mermaid-${Math.random().toString(36).slice(2)}`

      // Attempt 1: render as-is
      try {
        const { svg } = await mermaidLib.render(id, source)
        if (!cancelled) {
          setSvgContent(svg)
          setError(null)
        }
        return
      } catch (err1) {
        const msg = err1 instanceof Error ? err1.message : String(err1)

        // Attempt 2: apply targeted fixes based on error pattern
        let patched = source
        let changed = false

        // Fix: strip all %% comments (ER + other diagrams)
        if (/COMMENT|%%/.test(msg)) {
          patched = patched.replace(/^[ \t]*%%.*$/gm, '')
          changed = true
        }
        // Fix: unquote identifiers (state diagrams)
        if (/STRING|quotes?|"/i.test(msg) && /stateDiagram/i.test(source.split('\n')[0] ?? '')) {
          patched = patched.replace(/"([A-Za-z_]\w*)"/g, '$1')
          changed = true
        }
        // Fix: CRLF line endings
        if (/NEWLINE|newline/i.test(msg)) {
          patched = patched.replace(/\r\n/g, '\n')
          changed = true
        }

        if (changed && patched !== source) {
          const retryId = `mermaid-retry-${Math.random().toString(36).slice(2)}`
          try {
            const { svg } = await mermaidLib.render(retryId, patched)
            if (!cancelled) {
              setSvgContent(svg)
              setError(null)
            }
            return
          } catch {
            // Retry also failed — fall through to show original error
          }
        }

        // All attempts failed
        if (!cancelled) {
          setError(msg)
          setSvgContent(null)
        }
      }
    }

    renderWithRetry()

    return () => { cancelled = true }
  }, [source, theme, retryCount])
  const clean = useMemo(
    () => svgContent ? DOMPurify.sanitize(svgContent, { USE_PROFILES: { svg: true, svgFilters: true } }) : null,
    [svgContent]
  )

  if (error) {
    return (
      <MermaidError
        error={error}
        chart={source}
        retry={() => {
          setError(null)
          setSvgContent(null)
          setRetryCount((c) => c + 1)
        }}
      />
    )
  }
  if (!clean) return null
  return (
    <div
      className="my-2 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}

const ARTIFACT_LANG_RE = /^language-artifact-(html|react|svg|chartjs|vega)$/i

// JSX/TSX/React/SVG blocks are always auto-rendered as artifacts (no click required)
const AUTO_RENDER_LANGS = new Set(['language-jsx', 'language-tsx', 'language-react'])

// HTML blocks show a "Render" button (may be code snippets, not full artifacts)
const RENDER_BUTTON_LANG_MAP: Record<string, ArtifactType> = {
  'language-html': 'html',
}

/**
 * If a HAST pre node wraps an artifact code block, returns the type and source.
 * Handles:
 *   1. Explicit artifact-* fences (artifact-html, artifact-react, etc.)
 *   2. Full HTML documents in plain ```html blocks (<!DOCTYPE html or <html)
 *   3. JSX / TSX / React blocks — always auto-rendered as React artifacts
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

  // 2. JSX / TSX / React blocks — auto-render without requiring a button click
  if (strClasses.some((c) => AUTO_RENDER_LANGS.has(c))) {
    return { type: 'react', source: extractHastText(codeEl) }
  }

  // 3. SVG blocks — always visual, always auto-render
  if (strClasses.some((c) => c === 'language-svg')) {
    return { type: 'svg', source: extractHastText(codeEl) }
  }

  // 4. Auto-detect full HTML documents in plain ```html blocks
  if (strClasses.some((c) => c === 'language-html')) {
    const source = extractHastText(codeEl)
    if (/^<!DOCTYPE\s+html|^<html/i.test(source.trim())) {
      return { type: 'html', source }
    }
  }

  return null
}

/**
 * If a HAST pre node wraps a plain html/svg block that isn't a full document,
 * returns the type and source so a "Render" button can be shown.
 * JSX/TSX/React are handled by getArtifactInfo and never reach this function.
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
    const type = RENDER_BUTTON_LANG_MAP[cls]
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
  const mermaidThemeRef = useRef(mermaidTheme)
  mermaidThemeRef.current = mermaidTheme

  // Memoize the normalized content to avoid reprocessing on every render
  const normalizedContent = useMemo(
    () => sanitizeMermaidFences(normalizeLatex(content)),
    [content]
  )

  // Extract mermaid block sources directly from the string (in document order).
  // Accessed via ref so preOverride closure doesn't need it as a dep.
  const mermaidBlocksRef = useRef<string[]>([])
  mermaidBlocksRef.current = useMemo(() => extractMermaidBlocks(normalizedContent), [normalizedContent])

  // Counter reset at the start of every render so each render pass indexes from 0.
  const mermaidIdxRef = useRef(0)
  mermaidIdxRef.current = 0

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
          // Debug: log first code block we encounter so devs can verify detection
          if (import.meta.env.DEV) {
            const _codeEl = ((node as Record<string, unknown>)?.children as Record<string, unknown>[] | undefined)?.[0]
            const _cls = (_codeEl?.properties as Record<string, unknown> | undefined)?.className
            if (Array.isArray(_cls) && _cls.length > 0) {
              console.debug('[RenderMarkdown] pre node classes:', _cls)
            }
          }

          // 0. Mermaid diagrams — use source extracted from the raw content string
          //    to avoid Shiki stripping newlines from the HAST text nodes.
          if (isMermaidNode(node)) {
            // Primary: indexed lookup from pre-extracted string blocks
            const indexed = mermaidBlocksRef.current[mermaidIdxRef.current++]
            // Fallback: walk the HAST text nodes (handles edge cases where
            // the extraction regex didn't match the fence)
            const hastSource = indexed === undefined
              ? extractHastText(((node as Record<string, unknown>).children as unknown[] | undefined)?.[0]).trim()
              : undefined
            const source = indexed ?? hastSource ?? ''
            if (!source) return <>{children}</>
            return <MermaidDiagram source={source} theme={mermaidThemeRef.current} />
          }

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
    prevProps.isStreaming === nextProps.isStreaming
)
