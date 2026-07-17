import { describe, expect, it } from 'vitest'
import {
  getMcpToolFailureMessage,
  normalizeMcpResultForToolOutput,
} from '../mcp-result'

describe('getMcpToolFailureMessage', () => {
  it('returns undefined for successful results without error flags', () => {
    expect(
      getMcpToolFailureMessage({
        content: [{ type: 'text', text: '{"ok":true}' }],
      })
    ).toBeUndefined()
  })

  it('treats isError true as failure even when error string is empty', () => {
    expect(
      getMcpToolFailureMessage({
        error: '',
        isError: true,
        content: [{ type: 'text', text: 'permission denied' }],
      })
    ).toBe('permission denied')
  })

  it('treats is_error true (snake_case) as failure', () => {
    expect(
      getMcpToolFailureMessage({
        is_error: true,
        content: [{ type: 'text', text: 'quota exceeded' }],
      })
    ).toBe('quota exceeded')
  })

  it('prefers a non-empty top-level error string', () => {
    expect(
      getMcpToolFailureMessage({
        error: 'bridge failed',
        isError: true,
        content: [{ type: 'text', text: 'ignored' }],
      })
    ).toBe('bridge failed')
  })
})

describe('normalizeMcpResultForToolOutput', () => {
  it('does not report success for isError results', () => {
    expect(
      normalizeMcpResultForToolOutput(
        {
          isError: true,
          content: [{ type: 'text', text: 'upload rejected' }],
        },
        'File uploaded successfully'
      )
    ).toEqual({ error: 'upload rejected' })
  })

  it('returns structured JSON content on success', () => {
    expect(
      normalizeMcpResultForToolOutput(
        {
          content: [{ type: 'text', text: '{"dataset_id":12}' }],
        },
        'ok'
      )
    ).toEqual({ dataset_id: 12 })
  })
})
