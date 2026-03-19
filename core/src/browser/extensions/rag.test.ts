import { describe, it, expect } from 'vitest'
import { RAGExtension, RAG_INTERNAL_SERVER } from './rag'
import { ExtensionTypeEnum } from '../extension'

class TestRAGExtension extends RAGExtension {
  onLoad() {}
  onUnload() {}
  async getTools() {
    return []
  }
  async getToolNames() {
    return ['search']
  }
  async callTool(_toolName: string, _args: Record<string, unknown>) {
    return { error: '', content: [] }
  }
  async ingestAttachments(_threadId: string, _files: any[]) {
    return { filesProcessed: 0, chunksInserted: 0, files: [] }
  }
  async ingestAttachmentsForProject(_projectId: string, _files: any[]) {
    return { filesProcessed: 0, chunksInserted: 0, files: [] }
  }
  async parseDocument(_path: string, _type?: string) {
    return 'parsed content'
  }
}

describe('RAGExtension', () => {
  it('returns ExtensionTypeEnum.RAG from type()', () => {
    const ext = new TestRAGExtension('url', 'test-rag')
    expect(ext.type()).toBe(ExtensionTypeEnum.RAG)
  })

  it('exports RAG_INTERNAL_SERVER constant', () => {
    expect(RAG_INTERNAL_SERVER).toBe('rag-internal')
  })

  it('can instantiate a concrete subclass', () => {
    const ext = new TestRAGExtension('http://localhost', 'rag-ext')
    expect(ext.name).toBe('rag-ext')
    expect(ext.url).toBe('http://localhost')
  })

  it('abstract methods are callable on concrete subclass', async () => {
    const ext = new TestRAGExtension('url', 'test')

    const tools = await ext.getTools()
    expect(tools).toEqual([])

    const toolNames = await ext.getToolNames()
    expect(toolNames).toEqual(['search'])

    const result = await ext.callTool('search', { query: 'test' })
    expect(result).toEqual({ error: '', content: [] })

    const ingestResult = await ext.ingestAttachments('thread-1', [])
    expect(ingestResult.filesProcessed).toBe(0)
    expect(ingestResult.chunksInserted).toBe(0)

    const projectResult = await ext.ingestAttachmentsForProject('proj-1', [])
    expect(projectResult.filesProcessed).toBe(0)

    const parsed = await ext.parseDocument('/path/to/doc.pdf')
    expect(parsed).toBe('parsed content')
  })
})
