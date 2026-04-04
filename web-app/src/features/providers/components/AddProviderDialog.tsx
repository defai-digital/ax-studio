import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const PROVIDER_NAME_REGEX = /^[a-zA-Z0-9\s\-_]+$/
const XSS_PATTERN = /<[^>]*>|javascript:|on\w+\s*=/i

function validateProviderName(
  name: string,
  existingProviderNames: string[]
): string | null {
  if (!name.trim()) {
    return null
  }
  if (!PROVIDER_NAME_REGEX.test(name)) {
    return 'Provider name can only contain letters, numbers, spaces, hyphens, and underscores.'
  }
  if (XSS_PATTERN.test(name)) {
    return 'Provider name contains invalid characters.'
  }
  if (
    existingProviderNames.some(
      (existing) => existing.toLowerCase() === name.toLowerCase()
    )
  ) {
    return `A provider named "${name}" already exists.`
  }
  return null
}

interface AddProviderDialogProps {
  onCreateProvider: (name: string) => void
  existingProviderNames?: string[]
  children: React.ReactNode
}

export function AddProviderDialog({
  onCreateProvider,
  existingProviderNames = [],
  children,
}: AddProviderDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const handleNameChange = (value: string) => {
    setName(value)
    const error = validateProviderName(value, existingProviderNames)
    setValidationError(error)
  }

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) return

    const error = validateProviderName(trimmed, existingProviderNames)
    if (error) {
      setValidationError(error)
      return
    }

    onCreateProvider(trimmed)
    setName('')
    setValidationError(null)
    setIsOpen(false)
  }

  const handleCancel = () => {
    setName('')
    setValidationError(null)
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim() && !validationError) {
      e.preventDefault()
      handleCreate()
    }
    e.stopPropagation()
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setName('')
      setValidationError(null)
    }
  }

  const isCreateDisabled = !name.trim() || !!validationError

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          createButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('provider:addOpenAIProvider')}</DialogTitle>
        </DialogHeader>
        <div>
          <input
            data-testid="input"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className={`w-full px-4 py-2.5 rounded-xl bg-muted/50 border outline-none text-[14px] focus:border-primary/30 transition-colors ${
              validationError
                ? 'border-red-500/50 focus:border-red-500/70'
                : 'border-border/50'
            }`}
            placeholder={t('provider:enterNameForProvider')}
            onKeyDown={handleKeyDown}
          />
          {validationError && (
            <p data-testid="validation-error" className="text-red-500 text-xs mt-1.5 px-1">
              {validationError}
            </p>
          )}
        </div>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleCancel}
            >
              {t('common:cancel')}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              ref={createButtonRef}
              disabled={isCreateDisabled}
              onClick={handleCreate}
              className="w-full sm:w-auto"
              size="sm"
              aria-label={t('common:create')}
            >
              {t('common:create')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
