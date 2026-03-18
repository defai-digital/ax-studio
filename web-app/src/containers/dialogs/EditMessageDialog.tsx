import { useState, useEffect, useRef, useMemo } from 'react'
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
import { FileText, X } from 'lucide-react'
import { IconPencil } from '@tabler/icons-react'
import {
  extractFilesFromPrompt,
  injectFilesIntoPrompt,
  FileMetadata,
} from '@/lib/fileMetadata'
import { useModelProvider } from '@/hooks/useModelProvider'

interface EditMessageDialogProps {
  message: string
  imageUrls?: string[]
  onSave: (message: string) => void
  triggerElement?: React.ReactNode
}

export function EditMessageDialog({
  message,
  imageUrls,
  onSave,
  triggerElement,
}: EditMessageDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const { files: initialFiles, cleanPrompt: initialCleanPrompt } = useMemo(
    () => extractFilesFromPrompt(message),
    [message],
  )
  const [draft, setDraft] = useState(initialCleanPrompt)
  const [keptImages, setKeptImages] = useState<string[]>(imageUrls || [])
  const [keptFiles, setKeptFiles] = useState<FileMetadata[]>(initialFiles)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedModel = useModelProvider((state) => state.selectedModel)

  useEffect(() => {
    const { files, cleanPrompt } = extractFilesFromPrompt(message)
    setDraft(cleanPrompt)
    setKeptImages(imageUrls || [])
    setKeptFiles(files)
  }, [message, imageUrls])

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus()
        textareaRef.current?.select()
      }, 100)
    }
  }, [isOpen])

  const handleSave = () => {
    const hasTextChanged = draft !== initialCleanPrompt
    const hasFilesChanged =
      JSON.stringify(keptFiles) !== JSON.stringify(initialFiles)

    if ((hasTextChanged || hasFilesChanged) && draft.trim()) {
      const finalMessage = injectFilesIntoPrompt(draft.trim(), keptFiles)
      onSave(finalMessage)
      setIsOpen(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave()
    }
  }

  const defaultTrigger = (
    <Button
      variant="ghost"
      size="icon-xs"
      role="button"
      tabIndex={0}
      disabled={!selectedModel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setIsOpen(true)
        }
      }}
    >
      <IconPencil size={16} />
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{triggerElement || defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('common:dialogs.editMessage.title')}</DialogTitle>
        </DialogHeader>

        {/* Attached files */}
        {keptFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keptFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50"
              >
                <FileText className="size-3.5 text-muted-foreground" />
                <span className="text-[12px] max-w-32 truncate">
                  {file.name}
                </span>
                <button
                  onClick={() =>
                    setKeptFiles((prev) =>
                      prev.filter((f) => f.id !== file.id),
                    )
                  }
                  className="p-0.5 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attached images */}
        {keptImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keptImages.map((imageUrl, index) => (
              <div
                key={`img-${index}`}
                className="relative size-14 rounded-lg overflow-hidden group border border-border/50"
              >
                <img
                  className="object-cover w-full h-full"
                  src={imageUrl}
                  alt={`Attached image ${index + 1}`}
                />
                <button
                  onClick={() =>
                    setKeptImages((prev) =>
                      prev.filter((_, i) => i !== index),
                    )
                  }
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full min-h-[140px] px-4 py-3 rounded-2xl bg-muted/30 border border-border/50 outline-none text-[14px] resize-y focus:border-primary/50 transition-colors"
          style={{ lineHeight: '1.6' }}
          placeholder={t('common:dialogs.editMessage.title')}
          aria-label={t('common:dialogs.editMessage.title')}
        />
        <div className="text-[11px] text-muted-foreground/50">
          {t('common:dialogs.editMessage.helpText')}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t('common:cancel')}
            </Button>
          </DialogClose>
          <Button
            disabled={
              (draft === initialCleanPrompt &&
                JSON.stringify(imageUrls || []) ===
                  JSON.stringify(keptImages) &&
                JSON.stringify(initialFiles) ===
                  JSON.stringify(keptFiles)) ||
              !draft.trim()
            }
            onClick={handleSave}
            size="sm"
          >
            {t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
