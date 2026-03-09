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
import { ingestResponseSchema } from '@/schemas/uploads.schema'
import { getRetrievalServiceUrl, doFetch } from '@/services/retrieval/client'

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
    const parsed = ingestResponseSchema.safeParse(data)
    if (!parsed.success) {
      console.warn('Retrieval service /ingest response did not match expected schema:', parsed.error.message)
    }
    return {
      id: parsed.success ? parsed.data.id : ulid(),
      chunkCount: parsed.success ? parsed.data.chunk_count : undefined,
      size: params.attachment.size,
    }
  }
}
