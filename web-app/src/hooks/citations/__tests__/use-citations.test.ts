import { beforeEach, describe, expect, it } from 'vitest'

import { useCitations } from '../use-citations'

const citationData = {
  sources: [
    {
      id: 'src-1',
      type: 'web' as const,
      url: 'https://example.com',
      title: 'Example',
      retrievedAt: 1,
    },
  ],
  confidence: 'high' as const,
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

  it('hydrates citation metadata once', () => {
    useCitations.getState().hydrate('message-1', { citationData })
    useCitations.getState().hydrate('message-1', {
      citationData: { ...citationData, confidence: 'low' },
    })

    expect(useCitations.getState().getCitations('message-1')).toEqual(
      citationData,
    )
  })

  it('ignores metadata without citation data', () => {
    useCitations.getState().hydrate('message-1', undefined)

    expect(useCitations.getState().getCitations('message-1')).toBeUndefined()
  })
})
