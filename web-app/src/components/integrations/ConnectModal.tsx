import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconExternalLink, IconEye, IconEyeOff, IconCheck, IconX } from '@tabler/icons-react'
import type { Integration } from '@/lib/integrations-registry'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  integration: Integration
  onConnect: (credentials: Record<string, string>) => Promise<void>
  onConnectOAuth?: (credentials: Record<string, string>) => Promise<void>
  onTest: (credentials: Record<string, string>) => Promise<string>
}

export function ConnectModal({ open, onOpenChange, integration, onConnect, onConnectOAuth, onTest }: Props) {
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [showFields, setShowFields] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const isOAuth = integration.authType === 'oauth2'

  useEffect(() => {
    if (open) {
      setCredentials({})
      setShowFields({})
      setTestResult(null)
      setTesting(false)
      setConnecting(false)
      setAuthorizing(false)
    }
  }, [open])

  const isFormValid = integration.fields.every((f) => credentials[f.key]?.trim())

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const message = await onTest(credentials)
      setTestResult({ success: true, message })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTestResult({ success: false, message })
    } finally {
      setTesting(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await onConnect(credentials)
      onOpenChange(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTestResult({ success: false, message })
    } finally {
      setConnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img
              src={integration.icon}
              alt={integration.name}
              className="w-5 h-5 dark:invert-[0.85]"
            />
            Connect {integration.name}
          </DialogTitle>
          <DialogDescription>{integration.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {integration.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{field.label}</label>
                {field.docsUrl && (
                  <a
                    href={field.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    Get token <IconExternalLink size={12} />
                  </a>
                )}
              </div>
              <div className="relative">
                <Input
                  type={
                    field.type === 'password' && !showFields[field.key]
                      ? 'password'
                      : 'text'
                  }
                  placeholder={field.placeholder}
                  value={credentials[field.key] ?? ''}
                  onChange={(e) =>
                    setCredentials((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  className="pr-10"
                />
                {field.type === 'password' && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowFields((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showFields[field.key] ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {testResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                testResult.success
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : 'bg-red-500/10 text-red-700 dark:text-red-400'
              }`}
            >
              {testResult.success ? <IconCheck size={16} className="mt-0.5 shrink-0" /> : <IconX size={16} className="mt-0.5 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          {isOAuth ? (
            <Button
              size="sm"
              onClick={async () => {
                setAuthorizing(true)
                setTestResult(null)
                try {
                  await onConnectOAuth?.(credentials)
                  onOpenChange(false)
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  setTestResult({ success: false, message })
                } finally {
                  setAuthorizing(false)
                }
              }}
              disabled={!isFormValid || authorizing}
            >
              {authorizing ? 'Waiting for authorization...' : 'Authorize with Google'}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={!isFormValid || testing}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={!isFormValid || connecting}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
