import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { FileText, UploadIcon, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { createDocumentAttachment, type Attachment } from '@/types/attachment'
import { useAttachments } from '@/hooks/chat/useAttachments'
import { FileStat } from '@ax-studio/core'
import { useFileRegistry, projectCollectionId } from '@/lib/file-registry'
import { IconLoader2, IconPaperclip } from '@tabler/icons-react'

type ProjectFilesProps = {
  projectId: string
  lng: string
}

type ProjectFile = {
  id: string
  name?: string
  path?: string
  type?: string
  size?: number
  chunk_count: number
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let val = bytes
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024
    i++
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const SUPPORTED_EXTENSIONS = [
  'pdf',
  'docx',
  'txt',
  'md',
  'csv',
  'xlsx',
  'xls',
  'ods',
  'pptx',
  'html',
  'htm',
]

async function getFilesFromPaths(paths: string[]): Promise<string[]> {
  const files: string[] = []
  const { fs } = await import('@ax-studio/core')

  for (const path of paths) {
    try {
      const stat: FileStat | undefined = await fs.fileStat(path)
      if (stat?.isDirectory) {
        // Recursively get files from directory
        const dirFiles = await getFilesFromDirectory(path, fs)
        files.push(...dirFiles)
      } else {
        files.push(path)
      }
    } catch (e) {
      console.warn(`Failed to get stat for ${path}:`, e)
      files.push(path)
    }
  }
  return files
}

async function getFilesFromDirectory(
  dirPath: string,
  fs: typeof import('@ax-studio/core').fs
): Promise<string[]> {
  const files: string[] = []
  try {
    const entries = await fs.readdirSync(dirPath)
    for (const entry of entries) {
      console.log('Reading entry:', entry)
      const stat = await fs.fileStat(entry)
      if (stat?.isDirectory) {
        const nestedFiles = await getFilesFromDirectory(entry, fs)
        files.push(...nestedFiles)
      } else if (!stat?.isDirectory) {
        const ext = entry.split('.').pop()?.toLowerCase()
        if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
          files.push(entry)
        }
      }
    }
  } catch (e) {
    console.warn(`Failed to read directory ${dirPath}:`, e)
  }
  return files
}

export default function ProjectFiles({ projectId, lng }: ProjectFilesProps) {
  const { t } = useTranslation(lng)
  const serviceHub = useServiceHub()
  const attachmentsEnabled = useAttachments((s) => s.enabled)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)

  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const loadProjectFiles = useCallback(async () => {
    setLoading(true)
    try {
      const colId = projectCollectionId(projectId)
      const entries = useFileRegistry.getState().listFiles(colId)
      setFiles(
        entries.map((e) => ({
          id: e.file_id,
          name: e.file_name,
          path: e.file_path,
          type: e.file_type,
          size: e.file_size,
          chunk_count: e.chunk_count,
        }))
      )
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProjectFiles()
  }, [loadProjectFiles])

  const processFilePaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return

      // Get files from paths (recursively for directories)
      const filePaths = await getFilesFromPaths(paths)

      const maxFileSizeBytes =
        typeof maxFileSizeMB === 'number' && maxFileSizeMB > 0
          ? maxFileSizeMB * 1024 * 1024
          : undefined

      const preparedAttachments: Attachment[] = []
      for (const p of filePaths) {
        const name = p.split(/[\\/]/).pop() || p
        const fileType = name.split('.').pop()?.toLowerCase()

        // Filter unsupported file types
        if (!fileType || !SUPPORTED_EXTENSIONS.includes(fileType)) {
          toast.warning(
            t('common:toast.unsupportedFileType.title') ??
              'Unsupported file type',
            {
              description: name,
            }
          )
          continue
        }

        let size: number | undefined = undefined
        try {
          const stat = await import('@ax-studio/core').then((m) => m.fs.fileStat(p))
          size = stat?.size ? Number(stat.size) : undefined
        } catch (e) {
          console.warn('Failed to read file size for', p, e)
        }

        if (maxFileSizeBytes !== undefined && size && size > maxFileSizeBytes) {
          toast.error(t('common:errors.fileTooLarge') ?? 'File too large', {
            description: t('common:errors.fileTooLargeDescription', {
              fileName: name,
              maxFileSizeMB,
            }),
          })
          continue
        }

        preparedAttachments.push(
          createDocumentAttachment({
            name,
            path: p,
            fileType,
            size,
          })
        )
      }

      // Filter duplicates
      const existingPaths = new Set(
        files.filter((f) => f.path).map((f) => f.path)
      )
      const duplicates: string[] = []
      const newAttachments = preparedAttachments.filter((att) => {
        if (existingPaths.has(att.path)) {
          duplicates.push(att.name)
          return false
        }
        return true
      })

      if (duplicates.length > 0) {
        toast.warning(
          t('common:toast.fileAlreadyExists.title') ?? 'File already attached',
          {
            description: duplicates.join(', '),
          }
        )
      }

      if (newAttachments.length === 0) return

      setUploading(true)
      try {
        for (const att of newAttachments) {
          const result = await serviceHub
            .uploads()
            .ingestFileAttachmentForProject(projectId, att)
          if (!result.id) {
            throw new Error('Failed to ingest file')
          }
        }
        toast.success(
          t('common:toast.fileUploaded.title') ?? 'File uploaded successfully'
        )
        await loadProjectFiles()
      } catch (error) {
        console.error('Failed to upload file:', error)
        toast.error(
          t('common:toast.uploadFailed.title') ?? 'Failed to upload file',
          {
            description:
              error instanceof Error ? error.message : JSON.stringify(error),
          }
        )
      } finally {
        setUploading(false)
      }
    },
    [files, loadProjectFiles, maxFileSizeMB, projectId, serviceHub, t]
  )

  const handleUpload = async () => {
    if (!attachmentsEnabled) {
      toast.info(
        t('common:toast.attachmentsDisabledInfo.title') ??
          'Attachments are disabled in Settings'
      )
      return
    }

    try {
      const selection = await serviceHub.dialog().open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: 'Documents',
            extensions: SUPPORTED_EXTENSIONS,
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      await processFilePaths(paths)
    } catch (error) {
      console.error('Failed to open file dialog:', error)
      const desc =
        error instanceof Error ? error.message : JSON.stringify(error)
      toast.error(
        t('common:toast.uploadFailed.title') ?? 'Failed to upload file',
        {
          description: desc,
        }
      )
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (!attachmentsEnabled) {
      toast.info(
        t('common:toast.attachmentsDisabledInfo.title') ??
          'Attachments are disabled in Settings'
      )
      return
    }

    // Get file paths from the drop event (Tauri provides paths directly)
    const paths: string[] = []
    const items = e.dataTransfer.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file && 'path' in file && typeof file.path === 'string') {
            paths.push(file.path)
          }
        }
      }
    }

    if (paths.length === 0) {
      // Fallback for web: check dataTransfer.files
      const dtFiles = e.dataTransfer.files
      for (let i = 0; i < dtFiles.length; i++) {
        const file = dtFiles[i]
        if ('path' in file && typeof file.path === 'string') {
          paths.push(file.path)
        }
      }
    }

    if (paths.length > 0) {
      await processFilePaths(paths)
    }
  }

  const handleDeleteFile = async (fileId: string) => {
    try {
      const colId = projectCollectionId(projectId)
      useFileRegistry.getState().removeFile(colId, fileId)
      toast.success(
        t('common:toast.fileDeleted.title') ?? 'File deleted successfully'
      )
      await loadProjectFiles()
    } catch (error) {
      console.error('Failed to delete file:', error)
      toast.error(
        t('common:toast.deleteFailed.title') ?? 'Failed to delete file',
        {
          description:
            error instanceof Error ? error.message : JSON.stringify(error),
        }
      )
    }
  }

  const isEmpty = !loading && files.length === 0

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span style={{ fontSize: '13px', fontWeight: 500 }}>
          {t('common:projects.files')}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <UploadIcon className="size-3.5" />
          )}
          <span>Upload</span>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div
          className={cn(
            'flex flex-col items-center justify-center py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-all',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border/50 hover:bg-muted/30'
          )}
          onClick={handleUpload}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileText className="size-6 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-[12px] text-muted-foreground/50 text-center">
            {t('common:projects.filesDescription')}
          </p>
        </div>
      ) : (
        <div
          className={cn(
            'space-y-2 rounded-lg p-1 -m-1 transition-colors',
            isDragging && 'bg-primary/10 ring-2 ring-primary ring-dashed'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/30 group"
            >
              <IconPaperclip className="size-3.5 text-muted-foreground shrink-0" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[13px] flex-1 truncate">
                    {file.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{file.name}</p>
                </TooltipContent>
              </Tooltip>
              {file.size ? (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {formatBytes(file.size)}
                </span>
              ) : null}
              {file.chunk_count > 0 && (
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {file.chunk_count} chunks
                </span>
              )}
              <button
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                onClick={() => handleDeleteFile(file.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}

          <div
          className={cn(
            'flex mt-3 flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border/50 hover:bg-muted/30'
          )}
          onClick={handleUpload}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <FileText className="size-6 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-[12px] text-muted-foreground/50 text-center">
            {t('common:projects.filesDescription')}
          </p>
        </div>
        </div>
      )}
    </div>
  )
}
