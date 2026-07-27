import { useState } from 'react'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCcw,
  Unplug,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  connectAxBiDirect,
  disconnectAxBiDirect,
} from '@/lib/ax-bi/direct-client'
import { classifyAxBiConnectionError } from '@/lib/ax-bi/mcp-result'
import { useAxBiConnection } from '@/stores/ax-bi-connection-store'
import { cn } from '@/lib/utils'

/**
 * Zero-config AX BI connect card (Electron, migration matrix §4): asks ONLY
 * for the API key — the MCP URL defaults to the local AX BI stack and stays
 * hidden. On save the token goes to the OS keychain (safeStorage) and the
 * direct client handshakes + fetches authoring capabilities.
 */
export function AxBiConnectCard({
  onConnected,
}: {
  onConnected?: () => void
}) {
  const status = useAxBiConnection((state) => state.status)
  const storeMessage = useAxBiConnection((state) => state.message)
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const connecting = status === 'connecting'
  const connected = status === 'connected'

  async function handleConnect() {
    setErrorMessage('')
    try {
      await connectAxBiDirect({ token: token.trim() || undefined })
      setToken('')
      onConnected?.()
    } catch (error) {
      setErrorMessage(classifyAxBiConnectionError(error).message)
    }
  }

  async function handleDisconnect() {
    setErrorMessage('')
    try {
      await disconnectAxBiDirect()
      setToken('')
    } catch (error) {
      setErrorMessage(classifyAxBiConnectionError(error).message)
    }
  }

  return (
    <div
      data-testid="ax-bi-connect-card"
      className="rounded-md border border-border p-4"
    >
      {connected ? (
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">AX BI connected</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Chat can now delegate chart and dashboard requests to your local
              AX BI stack.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={connecting}
            onClick={() => void handleDisconnect()}
          >
            <Unplug className="size-3.5" />
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          <div className="text-sm font-medium">Connect to AX BI</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Start your local AX BI stack, then paste its MCP API key. Studio
            stores the key in the OS keychain and connects to the local AX BI
            server automatically.
          </p>
          <div className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Input
                id="ax-bi-connect-token"
                aria-label="AX BI API key or JWT"
                type={showToken ? 'text' : 'password'}
                autoComplete="off"
                value={token}
                placeholder={
                  status === 'unreachable'
                    ? 'Paste a replacement key, or retry the saved key'
                    : 'Paste the full sst_… key or JWT'
                }
                className="pr-10"
                onChange={(event) => setToken(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    (token.trim() || status === 'unreachable') &&
                    !connecting
                  ) {
                    void handleConnect()
                  }
                }}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={showToken ? 'Hide AX BI token' : 'Show AX BI token'}
                className="absolute right-0.5 top-1/2 -translate-y-1/2"
                onClick={() => setShowToken((visible) => !visible)}
              >
                {showToken ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
            <Button
              type="button"
              disabled={
                connecting || (!token.trim() && status !== 'unreachable')
              }
              onClick={() => void handleConnect()}
            >
              {connecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting
                </>
              ) : status === 'unreachable' && !token.trim() ? (
                <>
                  <RefreshCcw className="size-4" />
                  Retry
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </div>
        </>
      )}
      {errorMessage || (status === 'unreachable' && storeMessage) ? (
        <p className={cn('mt-2 text-xs text-destructive')}>
          {errorMessage || storeMessage}
        </p>
      ) : null}
    </div>
  )
}
