import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DefaultUploadsService,
  ensureAkidbAvailable,
} from '../uploads/default'
import { fabricDocumentId } from '@/lib/file-registry'
import { useFileRegistry } from '@/lib/file-registry'
import type { Attachment } from '@/types/attachment'
import type { ServiceHub } from '@/services'
import type { MCPService } from '../mcp/types'

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
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new DefaultUploadsService()
    useFileRegistry.setState({ files: {} })
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('ensureAkidbAvailable (ADR-005 contract gate)', () => {
    it('allows when fabric_ingest_run is present', async () => {
      const mcp = {
        getTools: vi
          .fn()
          .mockResolvedValue([{ name: 'fabric_ingest_run' }]),
      } as unknown as MCPService
      await expect(ensureAkidbAvailable(mcp)).resolves.toBeUndefined()
    })

    it('rejects empty tools without AX BI jargon', async () => {
      const mcp = {
        getTools: vi.fn().mockResolvedValue([]),
      } as unknown as MCPService
      try {
        await ensureAkidbAvailable(mcp)
        expect.unreachable('should have thrown')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        expect(msg).toMatch(/not available|Settings → MCP Servers/i)
        expect(msg).not.toMatch(/AX BI MCP and tool toggles/i)
      }
    })

    it('rejects AkiDB v0.9-only tools with contract-incompatible message', async () => {
      const mcp = {
        getTools: vi.fn().mockResolvedValue([
          { name: 'search' },
          { name: 'pack' },
          { name: 'memory_write' },
          { name: 'memory_read' },
          { name: 'status' },
        ]),
      } as unknown as MCPService
      try {
        await ensureAkidbAvailable(mcp)
        expect.unreachable('should have thrown')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        expect(msg).toMatch(/lacks compatible|fabric_ingest_run/i)
        expect(msg).not.toMatch(/AX BI|tool toggles/i)
      }
    })

    it('rejects fabric_search alone (ingest still required)', async () => {
      const mcp = {
        getTools: vi.fn().mockResolvedValue([{ name: 'fabric_search' }]),
      } as unknown as MCPService
      await expect(ensureAkidbAvailable(mcp)).rejects.toThrow(
        /not available|Settings → MCP Servers/i
      )
    })
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

      expect(result.id).toBe(fabricDocumentId('/tmp/report.pdf'))
      expect(result.chunkCount).toBe(12)
    })

    it('re-ingesting the same path returns the same registry file_id', async () => {
      const metrics = {
        filesSucceeded: 1,
        totalChunksGenerated: 4,
        errors: [],
      }
      const hub = makeServiceHub({
        error: '',
        content: [{ text: JSON.stringify(metrics) }],
      })
      service.setMcpService(hub.mcp())

      const first = await service.ingestFileAttachment(
        't1',
        makeDocAttachment({ path: '/tmp/report.pdf', name: 'report.pdf' })
      )
      const second = await service.ingestFileAttachment(
        't1',
        makeDocAttachment({ path: '/tmp/report.pdf', name: 'report.pdf' })
      )

      expect(second.id).toBe(first.id)
      expect(useFileRegistry.getState().listFiles('thread_t1')).toHaveLength(1)
      expect(useFileRegistry.getState().listFiles('thread_t1')[0].file_id).toBe(
        first.id
      )
    })

    it('accepts snake_case pipeline metric aliases from fabric_ingest_run', async () => {
      const hub = makeServiceHub({
        error: '',
        content: [
          {
            text: JSON.stringify({
              files_succeeded: '1',
              total_chunks_generated: '8',
              errors: [],
            }),
          },
        ],
      })
      service.setMcpService(hub.mcp())

      const result = await service.ingestFileAttachment(
        't1',
        makeDocAttachment()
      )

      expect(result.chunkCount).toBe(8)
    })

    it('rejects non-numeric success metrics from fabric_ingest_run', async () => {
      const hub = makeServiceHub({
        error: '',
        content: [
          {
            text: JSON.stringify({
              filesSucceeded: true,
              totalChunksGenerated: [12],
              errors: [],
            }),
          },
        ],
      })
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow('No files were successfully indexed')
    })

    it('ignores non-decimal chunk count strings from fabric_ingest_run', async () => {
      const hub = makeServiceHub({
        error: '',
        content: [
          {
            text: JSON.stringify({
              filesSucceeded: 1,
              totalChunksGenerated: '0x10',
              errors: [],
            }),
          },
        ],
      })
      service.setMcpService(hub.mcp())

      const result = await service.ingestFileAttachment(
        't1',
        makeDocAttachment()
      )

      expect(result.chunkCount).toBe(0)
    })

    it.each([
      ['12 chunks'],
      ['1e2'],
      ['12.5'],
      [''],
      ['9007199254740992'],
    ])(
      'ignores malformed chunk count string "%s" from fabric_ingest_run',
      async (totalChunksGenerated) => {
        const hub = makeServiceHub({
          error: '',
          content: [
            {
              text: JSON.stringify({
                filesSucceeded: 1,
                totalChunksGenerated,
                errors: [],
              }),
            },
          ],
        })
        service.setMcpService(hub.mcp())

        const result = await service.ingestFileAttachment(
          't1',
          makeDocAttachment()
        )

        expect(result.chunkCount).toBe(0)
      }
    )

    it('falls back to the next valid metric alias after a malformed value', async () => {
      const hub = makeServiceHub({
        error: '',
        content: [
          {
            text: JSON.stringify({
              filesSucceeded: 1,
              totalChunksGenerated: '12 chunks',
              total_chunks: '7',
              errors: [],
            }),
          },
        ],
      })
      service.setMcpService(hub.mcp())

      const result = await service.ingestFileAttachment(
        't1',
        makeDocAttachment()
      )

      expect(result.chunkCount).toBe(7)
    })

    it.each([['1 file'], ['1e0'], ['1.0'], ['0'], ['9007199254740992']])(
      'rejects malformed success metric string "%s" from fabric_ingest_run',
      async (filesSucceeded) => {
        const hub = makeServiceHub({
          error: '',
          content: [
            {
              text: JSON.stringify({
                filesSucceeded,
                totalChunksGenerated: 1,
                errors: [],
              }),
            },
          ],
        })
        service.setMcpService(hub.mcp())

        await expect(
          service.ingestFileAttachment('t1', makeDocAttachment())
        ).rejects.toThrow('No files were successfully indexed')
      }
    )

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

    it('throws when fabric_ingest_run sets isError without a top-level error string', async () => {
      const hub = makeServiceHub({
        error: '',
        isError: true,
        content: [{ text: 'ingest rejected by server' }],
      })
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow('ingest rejected by server')
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

    it('does not prefer alias counts when filesSucceeded is explicitly 0', async () => {
      const metrics = {
        filesSucceeded: 0,
        processed_files: 1,
        ok: 1,
        totalChunksGenerated: 0,
        errors: [{ path: '/tmp/report.pdf', message: 'parse failed' }],
      }
      const hub = makeServiceHub({
        error: '',
        content: [{ text: JSON.stringify(metrics) }],
      })
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow('parse failed')
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
      ).rejects.toThrow(/not available|Settings → MCP Servers/i)
    })

    it('throws contract-incompatible error for AkiDB v0.9-only tools', async () => {
      const hub = {
        mcp: () => ({
          getTools: vi.fn().mockResolvedValue([
            { name: 'search' },
            { name: 'pack' },
            { name: 'memory_write' },
            { name: 'memory_read' },
            { name: 'status' },
          ]),
          callTool: vi.fn(),
        }),
      } as unknown as ServiceHub
      service.setMcpService(hub.mcp())

      await expect(
        service.ingestFileAttachment('t1', makeDocAttachment())
      ).rejects.toThrow(/lacks compatible|fabric_ingest_run/i)
      expect(hub.mcp().callTool).not.toHaveBeenCalled()
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
