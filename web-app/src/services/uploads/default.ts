/**
 * Ax-Studio Uploads Service
 *
 * Handles document and image ingestion.  File attachments are sent to the
 * self-hosted Retrieval Service for parsing, chunking, and embedding.
 * The service URL is read from the persisted useAxStudioConfig store
 * (defaults to http://127.0.0.1:8001).
 */

import type { UploadsService, UploadResult } from './types'
import type { Attachment } from '@/types/attachment'
import { ulid } from 'ulidx'

const DEFAULT_RETRIEVAL_URL = 'http://127.0.0.1:8001'

function getRetrievalServiceUrl(): string {
  try {
    const stored = localStorage.getItem('ax-studio-service-config')
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { config?: { retrievalServiceUrl?: string } } }
      return parsed?.state?.config?.retrievalServiceUrl || DEFAULT_RETRIEVAL_URL
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_RETRIEVAL_URL
}

async function doFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    return tauriFetch(url, init)
  } catch {
    return fetch(url, init)
  }
}

export class DefaultUploadsService implements UploadsService {
  async ingestImage(_threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'image') throw new Error('ingestImage: attachment is not image')
    // Images are inlined directly by the chat transport; no upload needed yet.
    await new Promise((r) => setTimeout(r, 100))
    return { id: ulid() }
  }

  async ingestFileAttachment(threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error('ingestFileAttachment: attachment is not document')
    return this.ingestToRetrievalService({ threadId, scope: 'thread', attachment })
  }

  async ingestFileAttachmentForProject(
    projectId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error('ingestFileAttachmentForProject: attachment is not document')
    return this.ingestToRetrievalService({ projectId, scope: 'project', attachment })
  }

  private async ingestToRetrievalService(params: {
    attachment: Attachment
    threadId?: string
    projectId?: string
    scope: 'thread' | 'project'
  }): Promise<UploadResult> {
    const baseUrl = getRetrievalServiceUrl()

    const response = await doFetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: params.attachment.path,
        name: params.attachment.name,
        size: params.attachment.size,
        thread_id: params.threadId,
        project_id: params.projectId,
        scope: params.scope,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      throw new Error(
        `Retrieval service ingestion failed (${response.status}): ${errorText}`
      )
    }

    const data = await response.json()
    return {
      id: typeof data?.id === 'string' ? data.id : ulid(),
      chunkCount: typeof data?.chunk_count === 'number' ? data.chunk_count : undefined,
      size: params.attachment.size,
    }
  }
}
