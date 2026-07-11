import { useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface GlobalErrorProps {
  error: Error | unknown
}

const FEEDBACK_URL = 'https://discord.gg/cd5AD5zY6U'

export function GlobalError({ error }: GlobalErrorProps) {
  console.error('Error in root route:', error)
  const [showFull, setShowFull] = useState(false)

  const message =
    error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  return (
    <div className="flex h-screen w-full items-center justify-center overflow-auto bg-background p-5 text-foreground">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="size-7 text-destructive" strokeWidth={2} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Oops! Unexpected error occurred.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try to{' '}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onClick={() => window.location.reload()}
          >
            refresh this page
          </button>{' '}
          or{' '}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            contact us
          </a>{' '}
          if the problem persists.
        </p>

        <div
          className="mt-5 w-full rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-left text-sm text-destructive"
          role="alert"
        >
          <strong className="font-semibold">Error: </strong>
          <span className="break-words">{message}</span>
          {stack && (
            <div className="mt-2">
              <pre className="mt-2 max-h-[250px] overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-left text-xs text-muted-foreground">
                <code>
                  {showFull ? stack : stack.slice(0, 200)}
                </code>
              </pre>
              <button
                type="button"
                onClick={() => setShowFull(!showFull)}
                className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {showFull ? 'Show less' : 'Show more'}
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            size="sm"
            onClick={() => window.location.reload()}
            className="gap-2"
          >
            <RefreshCw className="size-3.5" />
            Refresh page
          </Button>
        </div>
      </div>
    </div>
  )
}
