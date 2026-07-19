import { useChatAttachments } from '@/hooks/chat/useChatAttachments'
import { useMessages } from '@/hooks/chat/useMessages'
import {
  projectCollectionId,
  threadCollectionId,
  useFileRegistry,
} from '@/lib/file-registry'
import { useChatSessions } from '@/stores/chat-session-store'

type ApprovedFile = { path: string; name: string }

function attachmentsFromMetadata(metadata: unknown): ApprovedFile[] {
  if (!metadata || typeof metadata !== 'object') return []
  const attachments = (metadata as Record<string, unknown>).document_attachments
  if (!Array.isArray(attachments)) return []
  return attachments.flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object') return []
    const { path, name } = attachment as Record<string, unknown>
    return typeof path === 'string' && typeof name === 'string'
      ? [{ path, name }]
      : []
  })
}

/** Resolve a model-supplied path only if it came from a user attachment or
 * the thread/project file registry. Native filesystem approval remains the
 * final enforcement layer; this prevents the model from selecting unrelated
 * previously-approved files.
 */
export function resolveApprovedAxBiFile(
  threadId: string,
  requestedPath: string,
  projectId?: string
): ApprovedFile | undefined {
  if (!requestedPath || requestedPath.includes('\0')) return undefined

  const candidates: ApprovedFile[] = []
  for (const attachment of useChatAttachments.getState().getAttachments(threadId)) {
    if (attachment.path) {
      candidates.push({ path: attachment.path, name: attachment.name })
    }
  }
  for (const message of useMessages.getState().getMessages(threadId)) {
    candidates.push(...attachmentsFromMetadata(message.metadata))
  }
  const sessionMessages =
    useChatSessions.getState().sessions[threadId]?.chat?.messages ?? []
  for (const message of sessionMessages) {
    candidates.push(...attachmentsFromMetadata(message.metadata))
  }

  const registry = useFileRegistry.getState()
  for (const file of registry.listFiles(threadCollectionId(threadId))) {
    candidates.push({ path: file.file_path, name: file.file_name })
  }
  if (projectId) {
    for (const file of registry.listFiles(projectCollectionId(projectId))) {
      candidates.push({ path: file.file_path, name: file.file_name })
    }
  }

  return candidates.find((candidate) => candidate.path === requestedPath)
}
