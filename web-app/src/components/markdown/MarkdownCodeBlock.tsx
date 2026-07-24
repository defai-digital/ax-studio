import { CodeBlock } from '@/components/ai-elements/code-block'
import { useClipboardCopy } from '@/hooks/ui/useClipboardCopy'
import { cn } from '@/lib/utils'
import { Check, Copy, Maximize2, Minimize2 } from 'lucide-react'
import {
  type ComponentProps,
  type ReactNode,
  isValidElement,
  useId,
  useState,
} from 'react'

const COLLAPSIBLE_LINE_COUNT = 20

type MarkdownCodeBlockProps = ComponentProps<'code'> & {
  'data-block'?: string
  node?: unknown
}

function extractCode(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(extractCode).join('')
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractCode(node.props.children)
  }
  return ''
}

export function MarkdownCodeBlock({
  children,
  className,
  node: _node,
  'data-block': dataBlock,
  ...props
}: MarkdownCodeBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { isCopied, copyToClipboard } = useClipboardCopy()
  const bodyId = useId()

  if (dataBlock !== 'true') {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  }

  const code = extractCode(children).replace(/\n$/, '')
  const language = className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? 'text'
  const isCollapsible = code.split('\n').length > COLLAPSIBLE_LINE_COUNT
  const isBodyExpanded = !isCollapsible || isExpanded

  return (
    <div
      className="markdown-code-block"
      data-language={language}
      data-streamdown="code-block"
    >
      <div data-streamdown="code-block-header">
        <span className="markdown-code-block__language">{language}</span>
        <div data-streamdown="code-block-actions">
          {isCollapsible ? (
            <button
              aria-controls={bodyId}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse code' : 'Expand code'}
              className="markdown-code-block__action"
              onClick={() => setIsExpanded((expanded) => !expanded)}
              title={isExpanded ? 'Collapse code' : 'Expand code'}
              type="button"
            >
              {isExpanded ? (
                <Minimize2 aria-hidden="true" size={15} />
              ) : (
                <Maximize2 aria-hidden="true" size={15} />
              )}
            </button>
          ) : null}
          <button
            aria-label={isCopied ? 'Copied' : 'Copy code'}
            className="markdown-code-block__action"
            data-streamdown="code-block-copy-button"
            onClick={() => void copyToClipboard(code)}
            title={isCopied ? 'Copied' : 'Copy code'}
            type="button"
          >
            {isCopied ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )}
          </button>
        </div>
      </div>

      <div
        className={cn(
          'markdown-code-block__body',
          !isBodyExpanded && 'markdown-code-block__body--collapsed'
        )}
        data-expanded={isBodyExpanded}
        data-streamdown="code-block-body"
        id={bodyId}
      >
        <CodeBlock
          className="rounded-none border-0 bg-transparent dark:border-0 dark:bg-transparent"
          code={code}
          language={language as ComponentProps<typeof CodeBlock>['language']}
        />
        {!isBodyExpanded ? (
          <div
            aria-hidden="true"
            className="markdown-code-block__fade"
          />
        ) : null}
      </div>
    </div>
  )
}
