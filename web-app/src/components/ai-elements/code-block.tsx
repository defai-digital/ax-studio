import { cn } from '@/lib/utils'
import DOMPurify from 'dompurify'
import { type HTMLAttributes, useEffect, useState } from 'react'
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
  const [html, setHtml] = useState<string>('')
  const [darkHtml, setDarkHtml] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    highlightCode(code, language, showLineNumbers)
      .then(([light, dark]) => {
        if (!cancelled) {
          setHtml(light)
          setDarkHtml(dark)
        }
      })
      .catch((error) => {
        console.error('[CodeBlock] Failed to highlight code:', error)
        // Fallback: show raw code when highlighting fails
        if (!cancelled) {
          const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
          const fallback = `<pre><code>${escaped}</code></pre>`
          setHtml(fallback)
          setDarkHtml(fallback)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, language, showLineNumbers])

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
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
        />
        <div
          className="hidden overflow-auto dark:block [&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:p-4 [&>pre]:text-sm [&_code]:font-mono [&_code]:text-sm"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "sanitized via DOMPurify"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(darkHtml) }}
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
