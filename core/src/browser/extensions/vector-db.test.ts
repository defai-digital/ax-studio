import { describe, it, expect } from 'vitest'
import { VectorDBExtension } from './vector-db'
import { ExtensionTypeEnum } from '../extension'
import type {
  VectorDBStatus,
  VectorChunkInput,
  VectorSearchResult,
  AttachmentFileInfo,
  VectorDBFileInput,
  VectorDBIngestOptions,
} from './vector-db'

class TestVectorDBExtension extends VectorDBExtension {
  onLoad() {}
  onUnload() {}
  async getStatus(): Promise<VectorDBStatus> {
    return { ann_available: true }
  }
  async createCollection(_threadId: string, _dimension: number) {}
  async insertChunks(_threadId: string, _fileId: string, _chunks: VectorChunkInput[]) {}
  async ingestFile(
    _threadId: string,
    _file: VectorDBFileInput,
    _opts: VectorDBIngestOptions
  ): Promise<AttachmentFileInfo> {
    return { id: 'file-1', chunk_count: 10 }
  }
  async searchCollection(
    _threadId: string,
    _query_embedding: number[],
    _limit: number,
    _threshold: number
  ): Promise<VectorSearchResult[]> {
    return [{ id: 'chunk-1', text: 'result', file_id: 'f1', chunk_file_order: 0, score: 0.95 }]
  }
  async deleteChunks(_threadId: string, _ids: string[]) {}
  async deleteFile(_threadId: string, _fileId: string) {}
  async deleteCollection(_threadId: string) {}
  async listAttachments(_threadId: string): Promise<AttachmentFileInfo[]> {
    return [{ id: 'att-1', name: 'doc.pdf', chunk_count: 5 }]
  }
  async getChunks(
    _threadId: string,
    _fileId: string,
    _startOrder: number,
    _endOrder: number
  ): Promise<VectorSearchResult[]> {
    return []
  }
  // Project-level stubs
  async createCollectionForProject(_projectId: string, _dimension: number) {}
  async insertChunksForProject(_projectId: string, _fileId: string, _chunks: VectorChunkInput[]) {}
  async ingestFileForProject(
    _projectId: string,
    _file: VectorDBFileInput,
    _opts: VectorDBIngestOptions
  ): Promise<AttachmentFileInfo> {
    return { id: 'pfile-1', chunk_count: 3 }
  }
  async searchCollectionForProject(
    _projectId: string,
    _query_embedding: number[],
    _limit: number,
    _threshold: number
  ): Promise<VectorSearchResult[]> {
    return []
  }
  async deleteChunksForProject(_projectId: string, _ids: string[]) {}
  async deleteFileForProject(_projectId: string, _fileId: string) {}
  async deleteCollectionForProject(_projectId: string) {}
  async listAttachmentsForProject(_projectId: string): Promise<AttachmentFileInfo[]> {
    return []
  }
  async getChunksForProject(
    _projectId: string,
    _fileId: string,
    _startOrder: number,
    _endOrder: number
  ): Promise<VectorSearchResult[]> {
    return []
  }
}

describe('VectorDBExtension', () => {
  it('returns ExtensionTypeEnum.VectorDB from type()', () => {
    const ext = new TestVectorDBExtension('url', 'test-vectordb')
    expect(ext.type()).toBe(ExtensionTypeEnum.VectorDB)
  })

  it('can be instantiated with name and url', () => {
    const ext = new TestVectorDBExtension('http://localhost', 'vdb-ext')
    expect(ext.name).toBe('vdb-ext')
    expect(ext.url).toBe('http://localhost')
  })

  it('getStatus returns expected structure', async () => {
    const ext = new TestVectorDBExtension('url', 'test')
    const status = await ext.getStatus()
    expect(status.ann_available).toBe(true)
  })

  it('ingestFile returns AttachmentFileInfo', async () => {
    const ext = new TestVectorDBExtension('url', 'test')
    const result = await ext.ingestFile(
      'thread-1',
      { path: '/doc.pdf', name: 'doc.pdf' },
      { chunkSize: 512, chunkOverlap: 64 }
    )
    expect(result.id).toBe('file-1')
    expect(result.chunk_count).toBe(10)
  })

  it('searchCollection returns scored results', async () => {
    const ext = new TestVectorDBExtension('url', 'test')
    const results = await ext.searchCollection('thread-1', [0.1, 0.2, 0.3], 10, 0.5)
    expect(results).toHaveLength(1)
    expect(results[0].score).toBe(0.95)
    expect(results[0].text).toBe('result')
  })

  it('listAttachments returns file info array', async () => {
    const ext = new TestVectorDBExtension('url', 'test')
    const attachments = await ext.listAttachments('thread-1')
    expect(attachments).toHaveLength(1)
    expect(attachments[0].name).toBe('doc.pdf')
    expect(attachments[0].chunk_count).toBe(5)
  })

  it('project-level ingestFile works independently', async () => {
    const ext = new TestVectorDBExtension('url', 'test')
    const result = await ext.ingestFileForProject(
      'proj-1',
      { path: '/doc.pdf' },
      { chunkSize: 256, chunkOverlap: 32 }
    )
    expect(result.id).toBe('pfile-1')
    expect(result.chunk_count).toBe(3)
  })
})
