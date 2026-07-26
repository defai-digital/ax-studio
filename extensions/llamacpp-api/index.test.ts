import { describe, expect, it } from 'vitest'

import { normalizeLlamacppConfig } from './index'

describe('normalizeLlamacppConfig', () => {
  it('coerces complete finite decimal strings', () => {
    const config = normalizeLlamacppConfig({
      timeout: ' 1e3 ',
      defrag_thold: '.25',
      rope_scale: '+2.5',
      n_gpu_layers: '12',
    })

    expect(config.timeout).toBe(1000)
    expect(config.defrag_thold).toBe(0.25)
    expect(config.rope_scale).toBe(2.5)
    expect(config.n_gpu_layers).toBe(12)
  })

  it('rejects JavaScript numeric coercion edge cases', () => {
    const config = normalizeLlamacppConfig({
      timeout: '',
      n_gpu_layers: '0x10',
      ctx_size: true,
      batch_size: '12abc',
      rope_scale: Infinity,
    })

    expect(config.timeout).toBe(600)
    expect(config.n_gpu_layers).toBe(0)
    expect(config.ctx_size).toBe(0)
    expect(config.batch_size).toBe(0)
    expect(config.rope_scale).toBe(1)
  })
})
