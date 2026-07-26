/**
 * Uploads service.
 *
 * The AkiDB/RAG ingestion pipeline (vector indexing via the MCP
 * `fabric_ingest_run` tool) was removed with the knowledge-base feature
 * (migration matrix §2.2). Attachments are now delivered to the model
 * inline — images as base64 content parts, documents as extracted text —
 * so ingestion is a lightweight registration that returns an attachment id.
 */

import type { UploadsService, UploadResult } from './types'
import type { Attachment } from '@/types/attachment'
import { ulid } from 'ulidx'

export class DefaultUploadsService implements UploadsService {
  async ingestImage(
    _threadId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    if (attachment.type !== 'image')
      throw new Error('ingestImage: attachment is not image')
    return { id: ulid() }
  }

  async ingestFileAttachment(
    _threadId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error('ingestFileAttachment: attachment is not document')
    return { id: ulid() }
  }
}
