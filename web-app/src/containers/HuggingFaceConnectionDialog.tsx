import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useHuggingFaceConnection } from '@/hooks/models/useHuggingFaceConnection'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

const VALIDATION_TIMEOUT_MS = 10_000

export function HuggingFaceConnectionButton({
  compact = false,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const { connected, isLoading, setDialogOpen } = useHuggingFaceConnection(
    useShallow((state) => ({
      connected: Boolean(state.token),
      isLoading: state.isLoading,
      setDialogOpen: state.setDialogOpen,
    }))
  )

  const label = connected
    ? t('hub:huggingFace.connected')
    : t('hub:huggingFace.connect')

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        'rounded-lg border-border/60 text-[12px]',
        connected &&
          'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
        className
      )}
      onClick={() => setDialogOpen(true)}
      aria-label={label}
    >
      {isLoading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : connected ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <KeyRound className="size-3.5" />
      )}
      {!compact && <span>{label}</span>}
    </Button>
  )
}

export function HuggingFaceConnectionDialog() {
  const { t } = useTranslation()
  const {
    token,
    accountName,
    dialogOpen,
    isConnecting,
    error,
    connect,
    disconnect,
    setDialogOpen,
  } = useHuggingFaceConnection(
    useShallow((state) => ({
      token: state.token,
      accountName: state.accountName,
      dialogOpen: state.dialogOpen,
      isConnecting: state.isConnecting,
      error: state.error,
      connect: state.connect,
      disconnect: state.disconnect,
      setDialogOpen: state.setDialogOpen,
    }))
  )
  const [draftToken, setDraftToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [editing, setEditing] = useState(false)
  const validationControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!dialogOpen) return
    setDraftToken('')
    setShowToken(false)
    setEditing(!token)
  }, [dialogOpen, token])

  useEffect(
    () => () => {
      validationControllerRef.current?.abort()
    },
    []
  )

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      validationControllerRef.current?.abort()
      validationControllerRef.current = null
    }
    setDialogOpen(open)
  }

  const handleConnect = async () => {
    validationControllerRef.current?.abort()
    const controller = new AbortController()
    validationControllerRef.current = controller
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      VALIDATION_TIMEOUT_MS
    )

    try {
      await connect(draftToken, controller.signal)
      if (!controller.signal.aborted) {
        setDraftToken('')
        setShowToken(false)
        setEditing(false)
      }
    } catch {
      // The store exposes a safe, user-facing error message inline.
    } finally {
      clearTimeout(timeoutId)
      if (validationControllerRef.current === controller) {
        validationControllerRef.current = null
      }
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnect()
      setDraftToken('')
      setEditing(true)
    } catch {
      // The store exposes a safe, user-facing error message inline.
    }
  }

  const connected = Boolean(token)
  const accountLabel = accountName
    ? t('hub:huggingFace.signedInAs', { name: accountName })
    : t('hub:huggingFace.savedOnDevice')

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-700 dark:text-amber-300">
            <KeyRound className="size-5" />
          </div>
          <DialogTitle>{t('hub:huggingFace.title')}</DialogTitle>
          <DialogDescription>
            {t('hub:huggingFace.description')}
          </DialogDescription>
        </DialogHeader>

        {connected && !editing ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t('hub:huggingFace.connectionActive')}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {accountLabel}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p>{t('hub:huggingFace.secureStorage')}</p>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={isConnecting}
                onClick={handleDisconnect}
              >
                {isConnecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unplug className="size-4" />
                )}
                {t('hub:huggingFace.disconnect')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isConnecting}
                onClick={() => setEditing(true)}
              >
                {t('hub:huggingFace.replaceToken')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="hugging-face-token" className="text-sm font-medium">
                {t('hub:huggingFace.tokenLabel')}
              </label>
              <div className="relative">
                <Input
                  id="hugging-face-token"
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={draftToken}
                  placeholder="hf_..."
                  className="pr-10 font-mono"
                  onChange={(event) => setDraftToken(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      draftToken.trim() &&
                      !isConnecting
                    ) {
                      event.preventDefault()
                      void handleConnect()
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={
                    showToken
                      ? t('hub:huggingFace.hideToken')
                      : t('hub:huggingFace.showToken')
                  }
                  onClick={() => setShowToken((visible) => !visible)}
                >
                  {showToken ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('hub:huggingFace.tokenHelp')}{' '}
                <a
                  href="https://huggingface.co/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {t('hub:huggingFace.createToken')}
                  <ExternalLink className="size-3" />
                </a>
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              {t('hub:huggingFace.licenseNote')}
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              {connected && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isConnecting}
                  onClick={() => setEditing(false)}
                >
                  {t('common:cancel')}
                </Button>
              )}
              <Button
                type="button"
                disabled={!draftToken.trim() || isConnecting}
                onClick={handleConnect}
              >
                {isConnecting && <Loader2 className="size-4 animate-spin" />}
                {isConnecting
                  ? t('hub:huggingFace.verifying')
                  : t('hub:huggingFace.connectAction')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
