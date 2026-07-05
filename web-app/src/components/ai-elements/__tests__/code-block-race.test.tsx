import { act, render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const resolvers = new Map<string, (value: [string, string]) => void>()
  const highlightCode = vi.fn(
    (code: string) =>
      new Promise<[string, string]>((resolve) => {
        resolvers.set(code, resolve)
      })
  )

  return {
    highlightCode,
    resolvers,
  }
})

vi.mock('../code-block-highlight', () => ({
  highlightCode: mocks.highlightCode,
}))

import { CodeBlock } from '../code-block'

function highlightedHtml(code: string) {
  return `<pre><code>${code}</code></pre>`
}

function getLightThemeContainer(container: HTMLElement) {
  const lightThemeContainer = container.querySelector(
    '[class*="dark\\:hidden"]'
  )
  if (!lightThemeContainer) {
    throw new Error('Light theme container not found')
  }
  return lightThemeContainer
}

describe('CodeBlock async highlighting', () => {
  it('ignores stale highlight results after the code changes', async () => {
    const { container, rerender } = render(
      <CodeBlock code="old code" language="javascript" />
    )

    rerender(<CodeBlock code="new code" language="javascript" />)

    await act(async () => {
      mocks.resolvers.get('new code')?.([
        highlightedHtml('new code'),
        highlightedHtml('new dark code'),
      ])
    })

    await waitFor(() => {
      expect(getLightThemeContainer(container).innerHTML).toContain('new code')
    })

    await act(async () => {
      mocks.resolvers.get('old code')?.([
        highlightedHtml('old code'),
        highlightedHtml('old dark code'),
      ])
    })

    expect(getLightThemeContainer(container).innerHTML).toContain('new code')
    expect(getLightThemeContainer(container).innerHTML).not.toContain(
      'old code'
    )
  })
})
