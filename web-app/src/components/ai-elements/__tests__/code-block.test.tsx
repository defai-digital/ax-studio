import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock shiki before importing the component
vi.mock('shiki', () => {
  const mockHighlighter = {
    codeToHtml: vi.fn(
      (code: string, opts: { theme: string }) =>
        `<pre><code class="${opts.theme}">${code}</code></pre>`
    ),
    loadLanguage: vi.fn().mockResolvedValue(undefined),
  }
  return {
    createHighlighter: vi.fn().mockResolvedValue(mockHighlighter),
  }
})

vi.mock('@/lib/shiki-theme-light', () => ({
  axStudioLightTheme: { name: 'ax-studio-light' },
}))

vi.mock('@/lib/shiki-theme-dark', () => ({
  axStudioDarkTheme: { name: 'ax-studio-dark' },
}))

import { CodeBlock, CodeBlockCopyButton, highlightCode } from '../code-block'

type RenderResult = ReturnType<typeof render>

const renderCodeBlock = async (ui: Parameters<typeof render>[0]): Promise<RenderResult> => {
  let result: RenderResult
  await act(async () => {
    result = render(ui)
    await Promise.resolve()
  })
  return result!
}

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a container div with the correct classes', async () => {
    const { container } = await renderCodeBlock(
      <CodeBlock code="const x = 1" language="javascript" />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('rounded-xl')
    expect(wrapper.className).toContain('border')
  })

  it('renders light and dark theme containers', async () => {
    const { container } = await renderCodeBlock(
      <CodeBlock code="hello" language="typescript" />
    )
    const divs = container.querySelectorAll('[class*="overflow-auto"]')
    // Light theme div (visible) and dark theme div (hidden)
    expect(divs.length).toBe(2)
    expect(divs[0].className).toContain('dark:hidden')
    expect(divs[1].className).toContain('dark:block')
  })

  it('renders children in the overlay position when provided', async () => {
    const { container } = await renderCodeBlock(
      <CodeBlock code="test" language="javascript">
        <button>Copy</button>
      </CodeBlock>
    )
    expect(screen.getByText('Copy')).toBeInTheDocument()
    const overlay = container.querySelector('.absolute.top-2.right-2')
    expect(overlay).toBeInTheDocument()
  })

  it('does not render overlay when no children', async () => {
    const { container } = await renderCodeBlock(
      <CodeBlock code="test" language="javascript" />
    )
    const overlay = container.querySelector('.absolute.top-2.right-2')
    expect(overlay).toBeNull()
  })

  it('applies custom className', async () => {
    const { container } = await renderCodeBlock(
      <CodeBlock code="x" language="javascript" className="my-custom" />
    )
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('my-custom')
  })

  it('populates innerHTML asynchronously after highlight', async () => {
    const { container } = await renderCodeBlock(
      <CodeBlock code="const y = 2" language="typescript" />
    )
    await waitFor(() => {
      const lightDiv = container.querySelector('[class*="dark\\:hidden"]')
      expect(lightDiv?.innerHTML).toContain('const y = 2')
    })
  })
})

describe('highlightCode', () => {
  it('returns a tuple of [lightHtml, darkHtml]', async () => {
    const result = await highlightCode('let a = 1', 'javascript' as never)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('let a = 1')
    expect(result[1]).toContain('let a = 1')
  })

  it('caches results for the same input', async () => {
    const r1 = await highlightCode('cached', 'javascript' as never)
    const r2 = await highlightCode('cached', 'javascript' as never)
    expect(r1).toBe(r2)
  })
})

describe('CodeBlockCopyButton', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders a copy button', async () => {
    await renderCodeBlock(
      <CodeBlock code="copy me" language="javascript">
        <CodeBlockCopyButton />
      </CodeBlock>
    )
    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
  })

  it('copies code to clipboard on click', async () => {
    await renderCodeBlock(
      <CodeBlock code="copy me" language="javascript">
        <CodeBlockCopyButton />
      </CodeBlock>
    )
    const button = screen.getByRole('button')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me')
  })

  it('calls onCopy callback after successful copy', async () => {
    const onCopy = vi.fn()
    await renderCodeBlock(
      <CodeBlock code="test" language="javascript">
        <CodeBlockCopyButton onCopy={onCopy} />
      </CodeBlock>
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('calls onError when clipboard API is not available', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: undefined },
    })
    const onError = vi.fn()
    await renderCodeBlock(
      <CodeBlock code="test" language="javascript">
        <CodeBlockCopyButton onError={onError} />
      </CodeBlock>
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Clipboard API not available' })
    )
  })

  it('calls onError when clipboard write fails', async () => {
    const clipboardError = new Error('Permission denied')
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(clipboardError),
      },
    })
    const onError = vi.fn()
    await renderCodeBlock(
      <CodeBlock code="test" language="javascript">
        <CodeBlockCopyButton onError={onError} />
      </CodeBlock>
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(onError).toHaveBeenCalledWith(clipboardError)
  })

  it('renders custom children instead of default icon', async () => {
    await renderCodeBlock(
      <CodeBlock code="test" language="javascript">
        <CodeBlockCopyButton>Custom Copy</CodeBlockCopyButton>
      </CodeBlock>
    )
    expect(screen.getByText('Custom Copy')).toBeInTheDocument()
  })
})
