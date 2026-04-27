import { type ReactNode, isValidElement, memo, useMemo, useState, useEffect, useRef, useCallback } from 'react'
import DOMPurify from 'dompurify'
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
  if (isValidElement(node) && node.props?.children) return extractTextFromNode(node.props.children)
  return ''
}
import 'katex/dist/katex.min.css'
import mermaidLib from 'mermaid'
import { useTheme } from '@/hooks/ui/useTheme'
import { ArtifactBlock } from '@/components/ai-elements/ArtifactBlock'
import { RenderableCodeBlock } from '@/components/ai-elements/RenderableCodeBlock'
import type { ArtifactType } from '@/lib/artifacts/harness'

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
export function sanitizeMermaidFences(input: string): string {
  // Characters that break Mermaid's parser inside unquoted [ ] labels
  const UNSAFE = /['()|<> ]/

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

  // Step 1b: Normalize fences where the diagram type is on the same line as
  // the opening fence — e.g. "```mermaid classDiagram" → "```mermaid\nclassDiagram"
  // This happens when some models omit the newline after the fence marker.
  text = text.replace(
    /```mermaid (classDiagram|flowchart|sequenceDiagram|gantt|erDiagram|pie|gitGraph|mindmap|timeline|xychart|quadrantChart|stateDiagram)/gi,
    (_m, diagramType) => `\`\`\`mermaid\n${diagramType}`
  )

  // Step 2: Process every (now properly closed) mermaid fence.
  return text.replace(
    /(```mermaid[^\n]*\n)([\s\S]*?)(```)/g,
    (_full, open, body: string, close) => {
      let fixed = body.trimStart()

      // Fix 1: strip any nested ```mermaid fence that the model put inside the source
      fixed = fixed.replace(/^```mermaid\s*/i, '').replace(/```\s*$/, '').trimStart()

      // Fix 1a: deduplicate diagram type header (models sometimes repeat it)
      fixed = fixed.replace(/^(stateDiagram-v2|stateDiagram|classDiagram|erDiagram|sequenceDiagram|gantt|flowchart|mindmap|pie|gitGraph|timeline|xychart|quadrantChart)\s+\1\b/i, '$1')

      // Fix 1b: strip invalid quoted title comments that some models add on the
      // diagram type line. e.g.:
      //   erDiagram """My Title"""  → erDiagram
      //   erDiagram ""My Title""   → erDiagram
      //   classDiagram "My Title"  → classDiagram
      // None of these are valid Mermaid syntax and cause parse errors.
      fixed = fixed.replace(/^(\w+)\s+"{1,3}[^"]*"{1,3}/m, '$1')

      // Fix 1c: Split single-line diagrams into proper multi-line format.
      // Some models output the entire diagram body on one line; Mermaid
      // requires each statement (relationship, entity, class, transition)
      // on its own line.  Detect few-lines + long-content and split at
      // statement boundaries per diagram type.
      const _nonBlank = fixed.split('\n').filter(l => l.trim()).length
      if (_nonBlank <= 3 && fixed.length > 40) {
        const _dtype = fixed.trimStart().split(/[\s/-]/)[0] ?? ''

        if (/^erDiagram$/i.test(_dtype)) {
          // Fix incomplete ER cardinalities: ||--| → ||--|| and }--| → }--|{
          // Models sometimes omit the second half of the right-side cardinality
          fixed = fixed.replace(/(\|\|--)\|(?![|{])/g, '$1||')   // ||--| → ||--||
          fixed = fixed.replace(/(}--)\|(?![|{])/g, '$1|{')      // }--| → }--|{
          fixed = fixed.replace(/(\|\|--o)(?![|{])/g, '$1{')     // ||--o → ||--o{

          // Strip quotes from entity names (models over-quote: "USER" ||--o{ "ORDER")
          // Only keep quotes for known SQL reserved words
          fixed = fixed.replace(/"([A-Z_]\w*)"/g, (_m, name) => {
            const reserved = /^(ORDER|GROUP|SELECT|FROM|WHERE|HAVING|USER|TABLE|INDEX|KEY|VALUE|SET|NOT|NULL|AND|OR|IN|BY|AS|ON|AT|TO|OF)$/
            return reserved.test(name) ? _m : name
          })
          // Split before each relationship (WORD or "WORD" CARDINALITY)
          fixed = fixed.replace(
            /(:[^\n]{0,80}?)\s+((?:"?[A-Z_]\w*"?\s+)?[|}o]{1,2}--[|{o]{1,2})/g,
            '$1\n$2'
          )
          // Split after "erDiagram" keyword
          fixed = fixed.replace(
            /(erDiagram)\s+((?:"?[A-Z_]\w*"?\s+)?[|}o]{1,2}--[|{o]{1,2})/gi,
            '$1\n$2'
          )
          // Split before each entity definition (WORD {)
          fixed = fixed.replace(
            /([^\n])\s+((?:"?[A-Z_]\w*"?\s+\{))/g,
            '$1\n$2'
          )
          // Fix orphan relationships: ||--o{ ENTITY : label (no left entity)
          // Try to extract entity from previous relationship's right side
          const lines = fixed.split('\n')
          const fixed2: string[] = []
          for (const line of lines) {
            const trimmed = line.trim()
            // Detect orphan: line starts with cardinality
            if (/^[|}o]{1,2}--[|{o]{1,2}\s/.test(trimmed)) {
              // Try to find the previous entity to reuse
              const prevEntity = fixed2.length > 0
                ? fixed2[fixed2.length - 1].match(/\w+\s*$/) ?? []
                : []
              const entity = prevEntity[0] || 'ENTITY'
              fixed2.push(entity + ' ' + trimmed)
            } else {
              fixed2.push(line)
            }
          }
          fixed = fixed2.join('\n')
        }

        if (/^classDiagram$/i.test(_dtype)) {
          // Split before class definitions
          fixed = fixed.replace(/([^\n])\s+(class\s)/g, '$1\n$2')
          // Split before relationship arrows  (<|--  ..|>  -->  ---)
          fixed = fixed.replace(
            /([^\n])\s+([A-Za-z_]\w*\s*(?:<\|--|\.\.[|>]|-->|---|\.\.>|\.\.))/g,
            '$1\n$2'
          )
          // Split attributes inside { } onto separate lines
          // e.g.  class Bank { +String name +int age }  →  each on own line
          fixed = fixed.replace(
            /(\{[^\n]*(?:[+\-#~]\s*\w+))/g,
            (match) => {
              const visCount = (match.match(/[+\-#~]\s*\w+/g) ?? []).length
              if (visCount <= 1) return match
              return match.replace(/\s*([+\-#~]\s*\w+)/g, '\n  $1').replace(/\{\s*\n/, '{\n')
            }
          )
        }

        if (/^stateDiagram(-v2)?$/i.test(_dtype)) {
          // Split before [*] --> transitions
          fixed = fixed.replace(/([^\n])\s+(\[\*\]\s*-->)/g, '$1\n$2')
          // Split before STATE --> transitions
          fixed = fixed.replace(/([^\n])\s+([A-Za-z_]\w*\s*-->)/g, '$1\n$2')
          // Split before state definitions
          fixed = fixed.replace(/([^\n])\s+(state\s)/g, '$1\n$2')
        }

        if (/^sequenceDiagram$/i.test(_dtype)) {
          // Split before arrow messages FIRST (before keyword splitting
          // to avoid false matches on "and", "end" etc. inside labels)
          fixed = fixed.replace(
            /([^\n])\s+(\w+\s*(?:->>|-->>|-\)|--x|->|-->|-x)\s*\w+\s*:)/g,
            '$1\n$2'
          )
          fixed = fixed.replace(
            /([^\n])\s+(\w+\s*(?:->>|-->>|->|-->|-\)|--x|-x)\s*\w+\s*$)/gm,
            '$1\n$2'
          )
          // Split before keywords (skip 'and' and 'end' which are common in
          // message labels — they get handled by the newline-based context)
          for (const kw of [
            'participant', 'actor ', 'autonumber',
            'Note right of', 'Note left of', 'Note over', 'Note right', 'Note left', 'Note ',
            'activate', 'deactivate',
            'loop ', 'alt ', 'else', 'opt ', 'rect ', 'par ',
            'create', 'destroy',
          ]) {
            fixed = fixed.replace(
              new RegExp(`([^\\n])\\s+(${kw.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')})`, 'g'),
              '$1\n$2'
            )
          }
        }

        if (/^mindmap$/i.test(_dtype)) {
          // Mindmap uses indentation for hierarchy.
          // Split at shape tokens: ((root)), [rect], {{cloud}}, (rounded)
          // and plain text nodes that follow closing shape tokens.
          const parts = fixed.split('\n')
          const expanded: string[] = []
          for (const line of parts) {
            if (line.trim().length < 3) { expanded.push(line); continue }
            // Split at shape boundaries: ))  ]]  }}  )(  etc.
            const split = line.replace(
              /(\)\)|\]\]|\}\})\s+(\(\(|\[|\{\{|[A-Za-z])/g,
              '$1\n$2'
            )
            // Also split plain text nodes that follow each other
            .replace(
              /([a-zA-Z][a-zA-Z0-9 _-]*)\s+([a-zA-Z][a-zA-Z0-9 _-]*\s)/g,
              (m, a, b) => {
                // Only split if both look like separate node labels
                if (a.length > 3 && b.length > 3) return a + '\n  ' + b
                return m
              }
            )
            expanded.push(...split.split('\n'))
          }
          fixed = expanded.join('\n')
        }
      }

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
        // Fix 4a: replace array type syntax (byte[], string[], etc.) that causes
        // lexical errors in Mermaid. Replace [] with Array suffix.
        fixed = fixed.replace(/\b(\w+)\[\]/g, '$1Array')

        // Fix 4b: deduplicate class definitions. LLMs sometimes output the same
        // class block twice. Keep only the first occurrence of each class name.
        const seenClasses = new Set<string>()
        const lines = fixed.split('\n')
        const filtered: string[] = []
        let skipUntilClose = false
        for (const line of lines) {
          const classMatch = line.match(/^\s*(?:class\s+)?(\w+)\s*\{/)
          if (classMatch) {
            if (seenClasses.has(classMatch[1])) {
              skipUntilClose = true
              continue
            }
            seenClasses.add(classMatch[1])
          }
          if (skipUntilClose) {
            if (/^\s*\}/.test(line)) {
              skipUntilClose = false
            }
            continue
          }
          filtered.push(line)
        }
        fixed = filtered.join('\n')

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

        // Fix 11: convert invalid relationship dash patterns to valid Mermaid ER syntax.
        // Some models output "----", "---", "--|", "|--", "-->", "--" etc. which are
        // invalid — valid ER relationships require cardinality markers.
        // Map common invalid patterns to ||--|| (one-to-one) as a safe fallback.
        fixed = fixed.replace(
          /^([ \t]*)(\w+)\s+(?:--[-|>]+|[-|]+-[-|>]*|[-]{2,}[|]?)\s+(\w+)\s*:/gm,
          '$1$2 ||--|| $3 :'
        )
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
            if (!trimmed || trimmed.startsWith('%%') || /^[\[({]/.test(trimmed)) return line
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

      // Fix 10a: gantt charts — remove blank lines after section headers.
      // Mermaid expects task data immediately after `section X`; a blank line
      // between the section header and the first task causes "Expecting
      // 'taskData', got 'NL'".
      if (/^gantt\b/i.test(firstLine)) {
        fixed = fixed.replace(/(^[ \t]*section\s+\S.*\n)\n+/gm, '$1')
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

/**
 * Extract all artifact-* blocks from the raw markdown string in document order.
 * Returns { type, source } pairs matched to HAST pre nodes by index.
 *
 * We extract from raw string because Shiki doesn't recognise "artifact-svg" etc.
 * as valid language identifiers — it falls back to "text", losing the CSS class
 * that the HAST-based getArtifactInfo() relies on.
 */
function extractArtifactBlocks(content: string): Array<{ type: ArtifactType; source: string }> {
  const blocks: Array<{ type: ArtifactType; source: string }> = []
  const ARTIFACT_TYPES: ArtifactType[] = ['html', 'react', 'svg', 'chartjs', 'vega']
  const pattern = new RegExp(
    `\`\`\`artifact-(${ARTIFACT_TYPES.join('|')})[^\\n]*\\n([\\s\\S]*?)\`\`\``,
    'gi'
  )
  let match
  while ((match = pattern.exec(content)) !== null) {
    const type = match[1].toLowerCase() as ArtifactType
    const source = match[2].trim()
    if (source) blocks.push({ type, source })
  }
  return blocks
}

/** Returns true if the HAST pre node wraps an artifact-* code block. */
function isArtifactNode(preNode: unknown): boolean {
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
    (c) => typeof c === 'string' && /^language-artifact-/i.test(c)
  )
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

    // Use 'loose' security: Mermaid v11 renders labels via <foreignObject> HTML,
    // which 'strict' mode strips. SVG is produced locally by mermaid — not user input.
    mermaidLib.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: (theme ?? 'default') as never,
      fontSize: 13,
      htmlLabels: true,
      flowchart: { useMaxWidth: true, htmlLabels: true },
      sequence: { useMaxWidth: true, actorFontSize: 13, noteFontSize: 12, messageFontSize: 13 },
      er: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
    })
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
        // Fix: quote [] labels containing spaces (SQE / UNICODE_TEXT error)
        if (/SQE|UNICODE_TEXT/i.test(msg)) {
          patched = patched.replace(
            /\[(?!["[/\\(>|])([^\]\n"]+)\]/g,
            (_m, inner: string) => {
              if (!/ /.test(inner)) return _m
              return `["${inner.replace(/"/g, '\\"')}"]`
            }
          )
          changed = true
        }
        // Fix: CRLF line endings
        if (/NEWLINE|newline/i.test(msg)) {
          patched = patched.replace(/\r\n/g, '\n')
          changed = true
        }
        // Fix: single-line diagram — split into multi-line
        if (/syntax error|parse error/i.test(msg)) {
          const srcLines = source.split('\n').filter(l => l.trim()).length
          if (srcLines <= 3 && source.length > 40) {
            patched = source
              // ER: fix orphan relationships (missing left entity)
              .replace(/(?:^|\n)\s*([|}o]{1,2}--[|{o]{1,2}\s+\w+\s*:)/gm, (_m, rest) => `UNKNOWN ${rest}`)
              // ER: strip unnecessary quotes from entity names
              .replace(/"([A-Z_]\w*)"/g, (_m, name) => {
                const reserved = /^(ORDER|GROUP|SELECT|FROM|WHERE|HAVING|USER|TABLE|INDEX|KEY|VALUE|SET|NOT|NULL|AND|OR|IN|BY|AS|ON|AT|TO|OF)$/
                return reserved.test(name) ? _m : name
              })
              // ER: split at relationships and entity definitions
              .replace(/([^\n])\s+([A-Z_]\w*\s+[|}o]{1,2}--[|{o]{1,2})/g, '$1\n$2')
              .replace(/([^\n])\s+([A-Z_]\w*\s+\{)/g, '$1\n$2')
              // Class: split at class keyword and relationship arrows
              .replace(/([^\n])\s+(class\s)/g, '$1\n$2')
              .replace(/([^\n])\s+([A-Za-z_]\w*\s*(?:<\|--|\.\.[|>]|-->|---|\.\.>|\.\.))/g, '$1\n$2')
              // State: split at transitions
              .replace(/([^\n])\s+(\[\*\]\s*-->)/g, '$1\n$2')
              .replace(/([^\n])\s+([A-Za-z_]\w*\s*-->)/g, '$1\n$2')
              // Sequence: split at arrow messages
              .replace(/([^\n])\s+(\w+\s*(?:->>|-->>|-\)|--x|->|-->|-x)\s+\w+\s*:)/g, '$1\n$2')
              // Sequence: split at keywords
              .replace(/([^\n])\s+(participant\s)/g, '$1\n$2')
              .replace(/([^\n])\s+(actor\s)/g, '$1\n$2')
              .replace(/([^\n])\s+(Note\s)/g, '$1\n$2')
            changed = true
          }
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

  if (error) {
    return (
      <details className="my-2 rounded-lg border border-destructive/20 bg-destructive/5">
        <summary className="px-3 py-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
          Mermaid diagram — syntax error (click to expand)
        </summary>
        <div className="px-3 pb-2">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto">{source}</pre>
          <p className="text-xs text-destructive mt-1">{error}</p>
        </div>
      </details>
    )
  }
  if (!svgContent) return null
  return (
    <div
      className="my-2 overflow-x-auto"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid SVG — generated locally by mermaid library, not user input. 'loose' mode needed for text labels via foreignObject.
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svgContent, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ['foreignObject', 'marker', 'defs', 'style'],
        ADD_ATTR: ['class', 'xmlns', 'style', 'marker-end', 'marker-start', 'marker-mid', 'dominant-baseline', 'text-anchor', 'rx', 'ry', 'stroke-dasharray', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family'],
      }) }}
      style={{ lineHeight: 1 }}
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

  // Extract artifact-* blocks from raw string — Shiki doesn't recognise
  // "artifact-svg" etc. so CSS-class detection fails; string extraction is reliable.
  const artifactBlocksRef = useRef<Array<{ type: ArtifactType; source: string }>>([])
  artifactBlocksRef.current = useMemo(() => extractArtifactBlocks(normalizedContent), [normalizedContent])

  // Counters reset at the start of every render so each render pass indexes from 0.
  const mermaidIdxRef = useRef(0)
  mermaidIdxRef.current = 0
  const artifactIdxRef = useRef(0)
  artifactIdxRef.current = 0

  /**
   * Custom `pre` component:
   * - Intercepts Mermaid, Artifact, and RenderableCodeBlock patterns.
   * - All other cases: return children unchanged (same as Streamdown default).
   *
   * Streamdown passes `passNode: true` so we receive the HAST pre node as `node`.
   * The `children` prop already holds the fully syntax-highlighted code block JSX
   * rendered by Streamdown's default `code` component (jt).
   */
  const preOverride = useMemo(
    () =>
      ({ node, children }: { node?: unknown; children?: ReactNode }) => {
        if (!isUser) {
          if (import.meta.env.DEV) {
            const _codeEl = ((node as Record<string, unknown>)?.children as Record<string, unknown>[] | undefined)?.[0]
            const _cls = (_codeEl?.properties as Record<string, unknown> | undefined)?.className
            if (Array.isArray(_cls) && _cls.length > 0) {
              console.debug('[RenderMarkdown] pre node classes:', _cls)
            }
          }

          if (!isStreaming && isMermaidNode(node)) {
            const indexed = mermaidBlocksRef.current[mermaidIdxRef.current++]
            const hastSource = indexed === undefined
              ? extractHastText(((node as Record<string, unknown>).children as unknown[] | undefined)?.[0]).trim()
              : undefined
            const source = indexed ?? hastSource ?? ''
            if (!source) return <>{children}</>
            return <MermaidDiagram source={source} theme={mermaidThemeRef.current} />
          }

          if (isArtifactNode(node)) {
            const artifact = artifactBlocksRef.current[artifactIdxRef.current++]
            if (artifact) {
              return (
                <ArtifactBlock type={artifact.type} source={artifact.source} threadId={threadId ?? messageId}>
                  {children}
                </ArtifactBlock>
              )
            }
          }

          {
            const next = artifactBlocksRef.current[artifactIdxRef.current]
            if (next) {
              const codeEl = (node as Record<string, unknown>)?.children as unknown[] | undefined
              const nodeText = codeEl ? extractHastText(codeEl[0]).trim() : ''
              if (nodeText === next.source) {
                artifactIdxRef.current++
                return (
                  <ArtifactBlock type={next.type} source={next.source} threadId={threadId ?? messageId}>
                    {children}
                  </ArtifactBlock>
                )
              }
            }
          }

          if (!isStreaming) {
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
          }

        }
        return <>{children}</>
      },
    [isUser, isStreaming, threadId, messageId]
  )

  // Citation-aware anchor override: renders [N] links as CitationChip when sources exist
  const citationData = useCitations((s) => messageId ? s.getCitations(messageId) : undefined)

  const anchorOverride = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ children, href, node, ...props }: any) => {
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
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.threadId === nextProps.threadId &&
    prevProps.isUser === nextProps.isUser &&
    prevProps.className === nextProps.className &&
    prevProps.components === nextProps.components
)
