import { beforeEach, describe, expect, it } from 'vitest'

import { useCitations } from '../use-citations'

const citationData = {
  sources: [
    {
      id: 'src-1',
      type: 'web' as const,
      url: 'https://example.com',
      title: 'Example',
      snippet: 'Example source',
      retrievedAt: 1,
    },
  ],
  confidence: 'moderate' as const,
}

describe('useCitations', () => {
  beforeEach(() => {
    useCitations.setState({ citationsByMessage: {} })
  })

  it('sets and retrieves citation data by message id', () => {
    useCitations.getState().setCitations('message-1', citationData)

    expect(useCitations.getState().getCitations('message-1')).toEqual(
      citationData,
    )
  })

  it('hydrates citation metadata idempotently', () => {
    useCitations.getState().hydrate('message-1', { citationData })
    const hydratedCitationData =
      useCitations.getState().getCitations('message-1')
    useCitations.getState().hydrate('message-1', {
      citationData: {
        ...citationData,
        sources: citationData.sources.map((source) => ({ ...source })),
      },
    })

    expect(useCitations.getState().getCitations('message-1')).toBe(
      hydratedCitationData
    )
  })

  it('updates hydrated citation metadata when the message metadata changes', () => {
    const updatedCitationData = {
      ...citationData,
      confidence: 'strong' as const,
      sources: [
        ...citationData.sources,
        {
          id: 'src-2',
          type: 'document' as const,
          title: 'Internal doc',
          snippet: 'Internal source',
          documentName: 'notes.md',
          retrievedAt: 2,
        },
      ],
    }

    useCitations.getState().hydrate('message-1', { citationData })
    useCitations.getState().hydrate('message-1', {
      citationData: updatedCitationData,
    })

    expect(useCitations.getState().getCitations('message-1')).toEqual(
      updatedCitationData
    )
  })

  it('ignores metadata without citation data', () => {
    useCitations.getState().hydrate('message-1', undefined)

    expect(useCitations.getState().getCitations('message-1')).toBeUndefined()
  })

  it('ignores malformed citation metadata', () => {
    useCitations.getState().hydrate('message-1', {
      citationData: {
        sources: [{ id: 'src-1', title: 'Missing fields' }],
        confidence: 'high',
      },
    })

    expect(useCitations.getState().getCitations('message-1')).toBeUndefined()
  })
})
