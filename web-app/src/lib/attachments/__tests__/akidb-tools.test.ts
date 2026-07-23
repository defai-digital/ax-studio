import { describe, it, expect } from 'vitest'
import {
  hasAkidbAttachmentTools,
  hasAkidbIngestOrExtractTools,
} from '../akidb-tools'

describe('hasAkidbAttachmentTools', () => {
  it('returns false when tools list is empty', () => {
    expect(hasAkidbAttachmentTools([])).toBe(false)
  })

  it('returns false for unrelated MCP tools (e.g. AX BI)', () => {
    expect(
      hasAkidbAttachmentTools([
        { name: 'create_chart_from_intent' },
        { name: 'upload_and_plan' },
      ])
    ).toBe(false)
  })

  it('returns true when fabric_ingest_run is present', () => {
    expect(
      hasAkidbAttachmentTools([{ name: 'fabric_ingest_run' }])
    ).toBe(true)
  })

  it('returns true when fabric_extract is present', () => {
    expect(hasAkidbAttachmentTools([{ name: 'fabric_extract' }])).toBe(true)
  })
})

describe('hasAkidbIngestOrExtractTools', () => {
  it('ignores fabric_search alone for ingest/extract probe', () => {
    expect(hasAkidbIngestOrExtractTools([{ name: 'fabric_search' }])).toBe(
      false
    )
  })

  it('returns true for fabric_ingest_run or fabric_extract', () => {
    expect(
      hasAkidbIngestOrExtractTools([{ name: 'fabric_ingest_run' }])
    ).toBe(true)
    expect(
      hasAkidbIngestOrExtractTools([{ name: 'fabric_extract' }])
    ).toBe(true)
  })
})
