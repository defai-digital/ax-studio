import { cn } from '@/lib/utils'
import DOMPurify from 'dompurify'
import { type HTMLAttributes, useEffect, useMemo, useState } from 'react'
import { highlightCode, type CodeBlockLanguage } from './code-block-highlight'

type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string
  language: CodeBlockLanguage
  showLineNumbers?: boolean
}

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const renderKey = `${language}:${showLineNumbers ? '1' : '0'}:${code}`
  const fallbackHtml = useMemo(() => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<pre><code>${escaped}</code></pre>`
  }, [code])
  const [highlighted, setHighlighted] = useState<{
    dark: string
    key: string
    light: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    highlightCode(code, language, showLineNumbers)
      .then(([light, dark]) => {
        if (!cancelled) {
          setHighlighted({ dark, key: renderKey, light })
        }
      })
      .catch((error) => {
        console.error('[CodeBlock] Failed to highlight code:', error)
      })

    return () => {
      cancelled = true
    }
  }, [code, language, renderKey, showLineNumbers])

  const html =
    highlighted?.key === renderKey ? highlighted.light : fallbackHtml
  const darkHtml =
    highlighted?.key === renderKey ? highlighted.dark : fallbackHtml
  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(html), [html])
  const sanitizedDarkHtml = useMemo(
    () => DOMPurify.sanitize(darkHtml),
    [darkHtml]
  )

  return (
    <div
      className={cn(
        'group relative w-full overflow-hidden rounded-xl border border-border dark:border-white/6 bg-background dark:bg-[#0d1117]',
        className
      )}
      {...props}
    >
      <div className="relative">
        <div
          className="overflow-auto dark:hidden [&>pre]:m-0 [&>pre]:bg-background! [&>pre]:p-4 [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "sanitized via DOMPurify"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
        <div
          className="hidden overflow-auto dark:block [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-4 [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "sanitized via DOMPurify"
          dangerouslySetInnerHTML={{ __html: sanitizedDarkHtml }}
        />
        {children && (
          <div className="absolute top-2 right-2 flex items-center gap-2">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
