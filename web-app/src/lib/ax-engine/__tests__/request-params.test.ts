import { describe, expect, it } from 'vitest'
import { toAxEngineOpenAIParams } from '../request-params'

describe('toAxEngineOpenAIParams', () => {
  it('maps Studio sampling fields onto engine OpenAI body keys', () => {
    expect(
      toAxEngineOpenAIParams({
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        repeat_penalty: 1.12,
        max_output_tokens: 4096,
        stop_sequences: ['END'],
      })
    ).toEqual({
      temperature: 0.7,
      top_p: 0.8,
      top_k: 20,
      repetition_penalty: 1.12,
      max_tokens: 4096,
      max_completion_tokens: 4096,
      stop: ['END'],
    })
  })

  it('prefers repetition_penalty over repeat_penalty when both are set', () => {
    expect(
      toAxEngineOpenAIParams({
        repeat_penalty: 1.1,
        repetition_penalty: 1.2,
      })
    ).toEqual({ repetition_penalty: 1.2 })
  })

  it('omits fail-closed OpenAI penalties even when provided', () => {
    const mapped = toAxEngineOpenAIParams({
      temperature: 0.5,
      frequency_penalty: 0.7,
      presence_penalty: 0.7,
    })
    expect(mapped).toEqual({ temperature: 0.5 })
    expect(mapped).not.toHaveProperty('frequency_penalty')
    expect(mapped).not.toHaveProperty('presence_penalty')
  })

  it('accepts max_completion_tokens as the preferred max field', () => {
    expect(
      toAxEngineOpenAIParams({ max_completion_tokens: 256 })
    ).toEqual({
      max_tokens: 256,
      max_completion_tokens: 256,
    })
  })
})
