import { describe, it, expect } from 'vitest'
import { huggingFaceRepoSchema } from '../models.schema'

describe('huggingFaceRepoSchema', () => {
  const validRepo = {
    id: 'TheBloke/Llama-2-7B-GGUF',
    modelId: 'TheBloke/Llama-2-7B-GGUF',
    sha: 'abc123def456',
    downloads: 50000,
    likes: 1200,
    tags: ['gguf', 'llama', 'text-generation'],
    createdAt: '2023-07-15T00:00:00.000Z',
    private: false,
    disabled: false,
    gated: false,
    author: 'TheBloke',
  }

  it('should validate a minimal valid repo', () => {
    const result = huggingFaceRepoSchema.safeParse(validRepo)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('TheBloke/Llama-2-7B-GGUF')
      expect(result.data.tags).toEqual(['gguf', 'llama', 'text-generation'])
      expect(result.data.gated).toBe(false)
    }
  })

  it('should validate with all optional fields', () => {
    const full = {
      ...validRepo,
      library_name: 'transformers',
      pipeline_tag: 'text-generation',
      last_modified: '2023-12-01T00:00:00.000Z',
      cardData: {
        license: 'apache-2.0',
        language: ['en', 'es'],
        datasets: ['wikipedia'],
        metrics: ['perplexity'],
      },
      siblings: [
        {
          rfilename: 'model.gguf',
          size: 4000000000,
          blobId: 'blob-1',
          lfs: {
            sha256: 'sha256hash',
            size: 4000000000,
            pointerSize: 132,
          },
        },
      ],
      readme: '# Model Card\nThis is a model.',
    }
    const result = huggingFaceRepoSchema.safeParse(full)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.siblings).toHaveLength(1)
      expect(result.data.siblings![0].rfilename).toBe('model.gguf')
      expect(result.data.cardData?.license).toBe('apache-2.0')
    }
  })

  it('should accept gated as a string', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      gated: 'auto',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.gated).toBe('auto')
    }
  })

  it('should fail when id is missing', () => {
    const { id: _, ...rest } = validRepo
    const result = huggingFaceRepoSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when modelId is missing', () => {
    const { modelId: _, ...rest } = validRepo
    const result = huggingFaceRepoSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when sha is missing', () => {
    const { sha: _, ...rest } = validRepo
    const result = huggingFaceRepoSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when downloads is not a number', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      downloads: 'many',
    })
    expect(result.success).toBe(false)
  })

  it('should fail when tags is not an array', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      tags: 'gguf',
    })
    expect(result.success).toBe(false)
  })

  it('should validate with empty tags array', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      tags: [],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tags).toEqual([])
    }
  })

  it('should fail when private is not a boolean', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      private: 'no',
    })
    expect(result.success).toBe(false)
  })

  it('should fail when gated is a number', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      gated: 123,
    })
    expect(result.success).toBe(false)
  })

  it('should validate siblings without optional fields', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      siblings: [{ rfilename: 'model.bin' }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.siblings![0].size).toBeUndefined()
      expect(result.data.siblings![0].lfs).toBeUndefined()
    }
  })

  it('should fail when sibling rfilename is missing', () => {
    const result = huggingFaceRepoSchema.safeParse({
      ...validRepo,
      siblings: [{ size: 1000 }],
    })
    expect(result.success).toBe(false)
  })
})
