import { describe, it, expect } from 'vitest'
import {
  binaryAttachmentSkipMessage,
  canIndexBinaryAttachments,
  classifyAttachmentIndexerCapability,
  hasAkidbAttachmentTools,
  hasAkidbIngestOrExtractTools,
  unavailableIndexerErrorMessage,
} from '../akidb-tools'

const AKI_V09_TOOLS = [
  { name: 'search' },
  { name: 'pack' },
  { name: 'memory_write' },
  { name: 'memory_read' },
  { name: 'status' },
]

describe('classifyAttachmentIndexerCapability', () => {
  it('classifies empty tools as none', () => {
    expect(classifyAttachmentIndexerCapability([])).toBe('none')
  })

  it('classifies unrelated tools (e.g. AX BI) as none', () => {
    expect(
      classifyAttachmentIndexerCapability([
        { name: 'create_chart_from_intent' },
        { name: 'list_datasets' },
      ])
    ).toBe('none')
  })

  it('classifies AkiDB v0.9 tool surface as aki-v09-only (not fabric)', () => {
    expect(classifyAttachmentIndexerCapability(AKI_V09_TOOLS)).toBe(
      'aki-v09-only'
    )
    expect(
      classifyAttachmentIndexerCapability([{ name: 'search' }, { name: 'pack' }])
    ).toBe('aki-v09-only')
  })

  it('classifies fabric tools as fabric-compatible', () => {
    expect(
      classifyAttachmentIndexerCapability([{ name: 'fabric_ingest_run' }])
    ).toBe('fabric-compatible')
    expect(
      classifyAttachmentIndexerCapability([{ name: 'fabric_extract' }])
    ).toBe('fabric-compatible')
    expect(
      classifyAttachmentIndexerCapability([{ name: 'fabric_search' }])
    ).toBe('fabric-compatible')
  })

  it('prefers fabric-compatible when both fabric and v0.9 tools are present', () => {
    expect(
      classifyAttachmentIndexerCapability([
        ...AKI_V09_TOOLS,
        { name: 'fabric_ingest_run' },
      ])
    ).toBe('fabric-compatible')
  })
})

describe('hasAkidbAttachmentTools', () => {
  it('returns false when tools list is empty', () => {
    expect(hasAkidbAttachmentTools([])).toBe(false)
  })

  it('returns false for AkiDB v0.9 tools alone (must not enable indexing probe)', () => {
    expect(hasAkidbAttachmentTools(AKI_V09_TOOLS)).toBe(false)
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

describe('hasAkidbIngestOrExtractTools / canIndexBinaryAttachments', () => {
  it('ignores fabric_search alone for ingest/extract probe', () => {
    expect(hasAkidbIngestOrExtractTools([{ name: 'fabric_search' }])).toBe(
      false
    )
    expect(canIndexBinaryAttachments([{ name: 'fabric_search' }])).toBe(false)
  })

  it('ignores AkiDB v0.9 tools for binary indexing', () => {
    expect(canIndexBinaryAttachments(AKI_V09_TOOLS)).toBe(false)
    expect(hasAkidbIngestOrExtractTools(AKI_V09_TOOLS)).toBe(false)
  })

  it('returns true for fabric_ingest_run or fabric_extract', () => {
    expect(
      hasAkidbIngestOrExtractTools([{ name: 'fabric_ingest_run' }])
    ).toBe(true)
    expect(
      hasAkidbIngestOrExtractTools([{ name: 'fabric_extract' }])
    ).toBe(true)
    expect(canIndexBinaryAttachments([{ name: 'fabric_ingest_run' }])).toBe(
      true
    )
  })
})

describe('user-facing messages', () => {
  it('v0.9 skip message mentions contract, not AX BI toggles', () => {
    const msg = binaryAttachmentSkipMessage('aki-v09-only')
    expect(msg.toLowerCase()).toMatch(/compatible|fabric/)
    expect(msg).not.toMatch(/AX BI/i)
    expect(msg).not.toMatch(/tool toggles/i)
  })

  it('none skip message points at Settings without AX BI jargon', () => {
    const msg = binaryAttachmentSkipMessage('none')
    expect(msg).toMatch(/Settings → MCP Servers/)
    expect(msg).not.toMatch(/AX BI/i)
  })

  it('unavailable indexer errors are contract-honest', () => {
    const v09 = unavailableIndexerErrorMessage('aki-v09-only')
    expect(v09).toMatch(/lacks compatible|fabric_ingest_run/i)
    expect(v09).not.toMatch(/AX BI/i)
    expect(v09).not.toMatch(/tool toggles/i)

    const none = unavailableIndexerErrorMessage('none')
    expect(none).toMatch(/not available|Settings → MCP Servers/i)
    expect(none).not.toMatch(/AX BI MCP and tool toggles/i)
  })
})
