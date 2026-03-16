
import { useControllableState } from '@radix-ui/react-use-controllable-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ToolUIPart } from 'ai'
import { ChevronDownIcon, WrenchIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { CodeBlock } from './code-block'

type ToolContextValue = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  state: ToolUIPart['state']
}

const ToolContext = createContext<ToolContextValue | null>(null)

export const useTool = () => {
  const context = useContext(ToolContext)
  if (!context) {
    throw new Error('Tool components must be used within Tool')
  }
  return context
}

export type ToolProps = ComponentProps<typeof Collapsible> & {
  className?: string
  state: ToolUIPart['state']
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const Tool = memo(
  ({
    className,
    state,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ToolProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    })

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen)
    }

    return (
      <ToolContext.Provider value={{ isOpen, setIsOpen, state }}>
        <Collapsible
          className={cn('not-prose', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ToolContext.Provider>
    )
  }
)

export type ToolHeaderProps = {
  title?: string
  state: ToolUIPart['state']
  type: ToolUIPart['type']
  className?: string
}

export const ToolHeader = memo(
  ({ className, title, state, type }: ToolHeaderProps) => {
    const { isOpen } = useTool()
    const toolName = title ?? type.split('-').slice(1).join('-')
    const isRunning = state === 'input-streaming' || state === 'input-available'
    // @ts-expect-error state only available in AI SDK v6
    const hasError = state === 'output-error' || state === 'output-denied'

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 text-[12px] font-medium text-muted-foreground transition-all px-3 py-2 rounded-xl border hover:bg-muted/60',
          isOpen
            ? 'bg-muted/30 border-border/50'
            : 'border-border/50 bg-muted/30',
          className
        )}
      >
        <WrenchIcon className="size-3.5 text-indigo-500 shrink-0" />
        <span className="font-mono capitalize">{toolName.replaceAll('_', ' ')}</span>
        {isRunning ? (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500">
            running
          </span>
        ) : hasError ? (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
            failed
          </span>
        ) : (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
            completed
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            'size-3.5 text-muted-foreground/50 transition-transform',
            isOpen ? 'rotate-180' : 'rotate-0'
          )}
        />
      </CollapsibleTrigger>
    )
  }
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>

export const ToolContent = memo(
  ({ className, children, ...props }: ToolContentProps) => (
    <CollapsibleContent
      className={cn(
        'mt-2 text-sm relative',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className
      )}
      {...props}
    >
      <div className="ml-2 pl-4 border-l-2 border-indigo-500/20">
        {children}
      </div>
    </CollapsibleContent>
  )
)

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolUIPart['input']
}

export const ToolInput = memo(
  ({ className, input, ...props }: ToolInputProps) => {
    return (
      <div className={cn('space-y-2', className)} {...props}>
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Parameters
        </h4>
        <div className="rounded-md max-h-40 overflow-auto border ">
          <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
        </div>
      </div>
    )
  }
)

type ToolImageProps = {
  data: string
  index: number
  resolver: (input: string) => Promise<string>
}

const ToolImage = memo(({ data, index }: ToolImageProps) => {
  // Prepare the URL - convert base64 to data URL if needed
  const [preparedUrl, setPreparedUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (data.startsWith('data:image') || data.startsWith('http')) {
      // Already a data URL or HTTP URL
      setPreparedUrl(data)
    } else {
      // Assume it's base64 encoded
      setPreparedUrl(`data:image/png;base64,${data}`)
    }
  }, [data])

  const isLoading = !preparedUrl

  if (isLoading) {
    return (
      <div className="flex justify-center">
        <div className="flex size-24 items-center justify-center rounded-md bg-muted">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    )
  }

  if (!preparedUrl) {
    return null
  }

  return (
    <div key={index} className="inline-block">
      <img
        src={preparedUrl}
        alt="Tool output"
        className="max-w-full max-h-96 w-auto h-auto object-contain rounded-md border"
      />
    </div>
  )
})

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolUIPart['output']
  errorText: ToolUIPart['errorText']
  resolver: (input: string) => Promise<string>
}

export const ToolOutput = memo(
  ({ className, output, errorText, resolver, ...props }: ToolOutputProps) => {
    const Output = useMemo(() => {
      if (!(output || errorText)) {
        return null
      }

      // Handle string output
      if (typeof output === 'string') {
        return (
          <div className="max-h-40 overflow-auto rounded-md border ">
            <CodeBlock code={output} language="json" />
          </div>
        )
      }

      if (typeof output === 'object' && !isValidElement(output)) {
        // Check if output has content array (new structure: {content: [{text, type}, {data, type: image}]})
        if (
          output &&
          typeof output === 'object' &&
          'content' in output &&
          Array.isArray(output.content)
        ) {
          const content = output.content as Array<{
            type: string
            text?: string
            data?: string
            mimeType?: string
          }>

          const textItems = content.filter((item) => item.type === 'text')
          const imageItems = content.filter((item) => item.type === 'image')

          return (
            <div className="space-y-4">
              {textItems.length > 0 && (
                <div className="space-y-2">
                  {textItems.map((item, index) => (
                    <div
                      key={index}
                      className="rounded-md max-h-40 overflow-auto border "
                    >
                      <CodeBlock code={item.text || ''} language="markdown" />
                    </div>
                  ))}
                </div>
              )}
              {imageItems.length > 0 && (
                <div className="space-y-2">
                  {imageItems.map((item, index) => (
                    <ToolImage
                      key={index}
                      data={item.data || ''}
                      index={index}
                      resolver={resolver}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        }

        // Handle old array format for backward compatibility
        if (Array.isArray(output)) {
          const hasImages = output.some(
            (item) => item?.type === 'image' && (item?.data || item?.image)
          )

          if (hasImages) {
            // Filter out images from JSON and render images separately
            const nonImageOutput = output.filter(
              (item) => item?.type !== 'image'
            )

            return (
              <div className="space-y-4">
                {nonImageOutput.length > 0 && (
                  <div className="rounded-md max-h-40 overflow-auto rounded-md border ">
                    <CodeBlock
                      code={JSON.stringify(nonImageOutput, null, 2)}
                      language="json"
                    />
                  </div>
                )}
                {output
                  .filter(
                    (item) =>
                      item?.type === 'image' && (item?.data || item?.image?.url)
                  )
                  .map((item, index) => (
                    <ToolImage
                      key={index}
                      data={item.data ?? item.image?.url}
                      index={index}
                      resolver={resolver}
                    />
                  ))}
              </div>
            )
          }

          return (
            <div className="rounded-md max-h-40 overflow-auto border ">
              <CodeBlock
                code={JSON.stringify(output, null, 2)}
                language="json"
              />
            </div>
          )
        }

        // Handle regular object
        return (
          <div className="rounded-md max-h-40 overflow-auto border ">
            <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
          </div>
        )
      }

      return <div>{output as ReactNode}</div>
    }, [output, errorText, resolver])

    if (!(output || errorText)) {
      return null
    }

    return (
      <div className={cn('space-y-2 mt-4', className)} {...props}>
        <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {errorText ? 'Error' : 'Result'}
        </h4>
        <div className="rounded-md overflow-hidden">
          {errorText && (
            <div className="m-2 p-2 bg-destructive/10 text-destructive rounded-md">
              {errorText}
            </div>
          )}
          {Output}
        </div>
      </div>
    )
  }
)

Tool.displayName = 'Tool'
ToolHeader.displayName = 'ToolHeader'
ToolContent.displayName = 'ToolContent'
ToolInput.displayName = 'ToolInput'
ToolOutput.displayName = 'ToolOutput'
