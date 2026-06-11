/**
 * ChatInputAttachments — renders the attachment preview tiles inside ChatInput.
 * Pure presentational component; no service calls or side effects.
 */
import { Loader2, Paperclip, X } from "lucide-react";
import { cn, formatBytes } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Attachment } from '@/types/attachment'
import { motion, AnimatePresence } from 'motion/react'

type Props = {
  attachments: Attachment[]
  onRemove: (index: number) => void
}

export function ChatInputAttachments({ attachments, onRemove }: Props) {
  if (attachments.length === 0) return null

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="overflow-hidden"
    >
      <div className="flex flex-col gap-2 p-2 pb-0">
        <div className="flex gap-3 items-center">
          <AnimatePresence>
            {attachments
              .map((att, idx) => ({ att, idx }))
              .map(({ att, idx }) => {
                const isImage = att.type === 'image'
                const ext = att.fileType || att.mimeType?.split('/')[1]
                return (
                  <motion.div
                    key={`${att.type}-${idx}-${att.name}`}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="relative"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'relative border rounded-xl size-14 overflow-hidden',
                            'flex items-center justify-center bg-card/50',
                            att.error && 'border-destructive',
                          )}
                        >
                          {isImage && att.dataUrl ? (
                            <img
                              className="object-cover w-full h-full"
                              src={att.dataUrl}
                              alt={att.name}
                            />
                          ) : att.processing ? (
                            <div className="flex items-center justify-center text-muted-foreground">
                              <Loader2 size={18} className="animate-spin" />
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center text-muted-foreground">
                              <Paperclip size={18} />
                              {ext && (
                                <span className="text-[10px] leading-none mt-0.5 uppercase opacity-70">
                                  .{ext}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs">
                          <div
                            className="font-medium truncate max-w-52"
                            title={att.name}
                          >
                            {att.name}
                          </div>
                          {att.error ? (
                            <div className="text-destructive truncate max-w-52">
                              {att.error}
                            </div>
                          ) : (
                            <div className="opacity-70">
                              {isImage
                                ? att.mimeType || 'image'
                                : ext
                                  ? `.${ext}`
                                  : 'document'}
                              {att.size ? ` · ${formatBytes(att.size)}` : ''}
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>

                    {!att.processing && (
                      <div
                        className="absolute -top-1 -right-2.5 bg-destructive size-5 flex rounded-full items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                        onClick={() => onRemove(idx)}
                      >
                        <X className="text-neutral-200" size={14} />
                      </div>
                    )}
                  </motion.div>
                )
              })}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}
