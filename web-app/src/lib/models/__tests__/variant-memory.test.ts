import { describe, expect, it } from 'vitest'
import {
  estimateVariantMemoryGB,
  getVariantMemoryInfo,
  getVariantMemoryLabel,
  parseFileSizeGB,
} from '../variant-memory'

describe('parseFileSizeGB', () => {
  it('parses catalog file sizes into GB', () => {
    expect(parseFileSizeGB('3.3 GB')).toBeCloseTo(3.3)
    expect(parseFileSizeGB('14.5 GB')).toBeCloseTo(14.5)
    expect(parseFileSizeGB('512.0 MB')).toBeCloseTo(0.5)
    expect(parseFileSizeGB('1.0 TB')).toBeCloseTo(1024)
  })

  it('returns null for missing or malformed sizes', () => {
    expect(parseFileSizeGB(undefined)).toBeNull()
    expect(parseFileSizeGB('')).toBeNull()
    expect(parseFileSizeGB('unknown')).toBeNull()
    expect(parseFileSizeGB('0 GB')).toBeNull()
    expect(parseFileSizeGB('3.3')).toBeNull()
  })
})

describe('estimateVariantMemoryGB', () => {
  it('applies the GGUF ×1.2 heuristic', () => {
    expect(estimateVariantMemoryGB(4, false)).toBeCloseTo(4.8)
  })

  it('treats MLX as file size × 1.0 (unified memory)', () => {
    expect(estimateVariantMemoryGB(4, true)).toBeCloseTo(4)
  })
})

describe('getVariantMemoryLabel', () => {
  const totalGB = 16

  it('labels comfortable fits as Recommended', () => {
    expect(getVariantMemoryLabel(4.8, totalGB)).toBe('Recommended')
    expect(getVariantMemoryLabel(9.6, totalGB)).toBe('Recommended') // ≤ 60%
  })

  it('labels tight fits as "Fits with tight memory"', () => {
    expect(getVariantMemoryLabel(10, totalGB)).toBe('Fits with tight memory')
    expect(getVariantMemoryLabel(13.6, totalGB)).toBe('Fits with tight memory') // ≤ 85%
  })

  it('labels oversized models as "Exceeds your RAM"', () => {
    expect(getVariantMemoryLabel(14, totalGB)).toBe('Exceeds your RAM')
    expect(getVariantMemoryLabel(23, totalGB)).toBe('Exceeds your RAM')
  })
})

describe('getVariantMemoryInfo', () => {
  it('returns estimate, text and label for a GGUF variant', () => {
    const info = getVariantMemoryInfo('4.0 GB', false, 16 * 1024)
    expect(info).not.toBeNull()
    expect(info?.estimatedGB).toBeCloseTo(4.8)
    expect(info?.estimatedText).toBe('≈ 4.8 GB')
    expect(info?.label).toBe('Recommended')
  })

  it('rounds estimates ≥ 10 GB to whole numbers', () => {
    const info = getVariantMemoryInfo('14.0 GB', false, 16 * 1024)
    expect(info?.estimatedText).toBe('≈ 17 GB')
    expect(info?.label).toBe('Exceeds your RAM')
  })

  it('uses the MLX factor for MLX variants', () => {
    const info = getVariantMemoryInfo('8.0 GB', true, 16 * 1024)
    expect(info?.estimatedGB).toBeCloseTo(8)
    expect(info?.label).toBe('Recommended')
  })

  it('returns null when hardware info is unavailable', () => {
    expect(getVariantMemoryInfo('4.0 GB', false, 0)).toBeNull()
    expect(getVariantMemoryInfo('4.0 GB', false, NaN)).toBeNull()
    expect(getVariantMemoryInfo('4.0 GB', false, -1)).toBeNull()
  })

  it('returns null when the file size is unknown', () => {
    expect(getVariantMemoryInfo(undefined, false, 16 * 1024)).toBeNull()
    expect(getVariantMemoryInfo('', false, 16 * 1024)).toBeNull()
  })
})
