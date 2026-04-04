import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultUploadsService } from '../uploads/default'
import { useFileRegistry } from '@/lib/file-registry'
import type { Attachment } from '@/types/attachment'
import type { ServiceHub } from '@/services'

// Mock ulidx
vi.mock('ulidx', () => {
  let counter = 0
  return { ulid: () => `ULID_${++counter}` }
})

function makeDocAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    name: 'report.pdf',
    type: 'document',
    path: '/tmp/report.pdf',
    fileType: 'pdf',
    size: 2048,
    ...overrides,
  }
}

function makeServiceHub(callToolResult: {
  error: string
  content: Array<{ text: string }>
}): ServiceHub {
  return {
    mcp: () => ({
      getTools: vi.fn().mockResolvedValue([
        { name: 'fabric_ingest_run', server: 'ax-studio' },
        { name: 'fabric_search', server: 'ax-studio' },
      ]),
      callTool: vi.fn().mockResolvedValue(callToolResult),
    }),
  } as unknown as ServiceHub
}

describe('DefaultUploadsService', () => {
  let service: DefaultUploadsService

  beforeEach(() => {
    service = new DefaultUploadsService()
    useFileRegistry.setState({ files: {} })
  })

  describe('ingestImage', () => {
    it('returns generated id for image attachment', async () => {
      const result = await service.ingestImage('t1', {
        name: 'photo.png',
        type: 'image',
        base64: 'abc',
        mimeType: 'image/png',
      })
      expect(result.id).toMatch(/^ULID_/)
    })

    it('throws if attachment is not image type', async () => {
      await expect(
        service.ingestImage('t1', makeDocAttachment())
      ).rejects.toThrow('not image')
    })
  })

  describe('ingestFileAttachment', () => {
    it('throws if attachment is not document', async () => {
      await expect(
        service.ingestFileAttachment('t1', {
          name: 'photo.png',
          type: 'image',
        })
      ).rejects.toThrow('not document')
    })

    it('throws if attachment has no path', async () => {
      await expect(
        service.ingestFileAttachment(
          't1',
          makeDocAttachment({ path: undefined })
        )
      ).rejects.toThrow('no file path')
    })

    it('returns generated id when serviceHub is not set (fallback)', async () => {
      const result = await service.ingestFileAttachment(
        't1',
        makeDocAttachment()
      )
      expect(result.id).toMatch(/^ULID_/)
    })

    it('calls fabric_ingest_run and returns chunk count', async () => {
      const metrics = {
        filesSucceeded: 1,
        totalChunksGenerated: 12,
        errors: [],
      }
      const hub = makeServiceHub({
        error: '',
        content: [{ text: JSON.stringify(metrics) }],
      })
      service.setMcpService(hub.mcp())

      const result = await service.ingestFileAttachment(
        't1',
        makeDocAttachment()
      )

      expect(result.id).toMatch(/^ULID_/)
      expect(result.chunkCount).toBe(12)
    })

    it('saves file to registry after successful ingestion', async () => {
      const metrics = {
        filesSucceeded: 1,
        totalChunksGenerated: 5,
        errors: [],
      }
      const hub = makeServiceHub({
        error: '',
        content: [{ text: JSON.stringify(metrics) }],
      })
      service.setMcpService(hub.mcp())

      await service.ingestFileAttachment('thread-abc', makeDocAttachment())

      const files = useFileRegistry.getState().listFiles('thread_thread-abc')
      expect(files).toHaveLength(1)
      expect(files[0].file_name).toBe('report.pdf')
      expect(files[0].chunk_count).toBe(5)
    })

    it('throws when fabric_ingest_run returns error', async () => {
      const hub = makeServiceHub({
        error: 'pipeline crashed',
        content: [],
      })
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow('pipeline crashed')
    })

    it('throws when filesSucceeded is 0', async () => {
      const metrics = {
        filesSucceeded: 0,
        totalChunksGenerated: 0,
        errors: [{ path: '/tmp/report.pdf', message: 'unsupported format' }],
      }
      const hub = makeServiceHub({
        error: '',
        content: [{ text: JSON.stringify(metrics) }],
      })
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow('unsupported format')
    })

    it('throws when MCP server is not available', async () => {
      const hub = {
        mcp: () => ({
          getTools: vi.fn().mockResolvedValue([]),
          callTool: vi.fn(),
        }),
      } as unknown as ServiceHub
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow('AkiDB is not configured')
    })
  })

  describe('ingestFileAttachmentForProject', () => {
    it('uses project collection id', async () => {
      const metrics = {
        filesSucceeded: 1,
        totalChunksGenerated: 3,
        errors: [],
      }
      const hub = makeServiceHub({
        error: '',
        content: [{ text: JSON.stringify(metrics) }],
      })
      service.setMcpService(hub.mcp())

      await service.ingestFileAttachmentForProject(
        'proj-1',
        makeDocAttachment()
      )

      const files = useFileRegistry.getState().listFiles('project_proj-1')
      expect(files).toHaveLength(1)
      expect(files[0].collection_id).toBe('project_proj-1')
    })
  })
})
