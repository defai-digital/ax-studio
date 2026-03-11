/**
 * No-op Uploads service.
 *
 * The self-hosted Retrieval Service (port 8001) that handled document
 * ingestion has been removed. This stub satisfies the UploadsService
 * interface so the rest of the app compiles without errors.
 */

import type { UploadsService, UploadResult } from './types'
import type { Attachment } from '@/types/attachment'
import { ulid } from 'ulidx'

export class DefaultUploadsService implements UploadsService {
  async ingestImage(_threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'image') throw new Error('ingestImage: attachment is not image')
    return { id: ulid() }
  }

  async ingestFileAttachment(_threadId: string, attachment: Attachment): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error('ingestFileAttachment: attachment is not document')
    return { id: ulid() }
  }

  async ingestFileAttachmentForProject(
    _projectId: string,
    attachment: Attachment,
  ): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error('ingestFileAttachmentForProject: attachment is not document')
    return { id: ulid() }
  }
}
