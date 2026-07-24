import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { RenderMarkdown } from '../RenderMarkdown'

vi.mock('@/components/ai-elements/code-block', () => ({
  CodeBlock: ({
    className,
    code,
  }: {
    className?: string
    code: string
  }) => (
    <div className={className}>
      <pre>
        <code>
          <span style={{ color: '#82aaff' }}>{code}</span>
        </code>
      </pre>
    </div>
  ),
}))

vi.mock('@i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
})

async function waitForSyntaxHighlight(container: HTMLElement) {
  await vi.waitFor(() => {
    expect(
      container.querySelector(
        '[data-streamdown="code-block-body"] span[style*="color"]'
      )
    ).toBeTruthy()
  })
}

describe('RenderMarkdown', () => {
  it('preserves line breaks in model responses (when isUser == undefined)', () => {
    const modelResponseWithNewLines = `This is line 1
    This is line 2
    This is line 3`
    render(<RenderMarkdown content={modelResponseWithNewLines} />)
    const markdownContainer = document.querySelector('.markdown')
    // Line breaks are preserved as newlines in the rendered HTML (not <br> tags)
    const text = markdownContainer?.textContent || ''
    expect(text).toContain('This is line 1')
    expect(text).toContain('This is line 2')
    expect(text).toContain('This is line 3')
  })

  it('preserves line breaks in user message (when isUser == true)', () => {
    const userMessageWithNewlines = `User question line 1
    User question line 2
    User question line 3`
    render(<RenderMarkdown content={userMessageWithNewlines} isUser={true} />)
    const markdownContainer = document.querySelector('.markdown')
    expect(markdownContainer).toBeTruthy()
    // Line breaks are preserved as newlines in the rendered HTML
    const text = markdownContainer?.textContent || ''
    expect(text).toContain('User question line 1')
    expect(text).toContain('User question line 2')
    expect(text).toContain('User question line 3')
  })

  it('preserves line breaks with different line ending types', () => {
    const contentWithDifferentLineEndings = 'Line1\nLine2\r\nLine3\rLine4'
    render(<RenderMarkdown content={contentWithDifferentLineEndings} />)
    const markdownContainer = document.querySelector('.markdown')
    // Line breaks are preserved as newlines in the rendered HTML
    const text = markdownContainer?.textContent || ''
    expect(text).toContain('Line1')
    expect(text).toContain('Line2')
    expect(text).toContain('Line3')
    expect(text).toContain('Line4')
  })

  it('handles empty lines correctly', () => {
    const contentWithEmptyLines =
      'Line 1\n\nLine 3 (after empty line)\n\nLine 5 (after two empty lines)'
    render(<RenderMarkdown content={contentWithEmptyLines} />)
    const markdownContainer = document.querySelector('.markdown')
    const text = markdownContainer?.textContent || ''
    // All content lines should be present
    expect(text).toContain('Line 1')
    expect(text).toContain('Line 3 (after empty line)')
    expect(text).toContain('Line 5 (after two empty lines)')
  })

  describe('LaTeX normalization - dollar sign escaping', () => {
    it('escapes dollar signs followed by numbers to prevent LaTeX interpretation', () => {
      const content = 'The price is $200 for the item'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$200')
    })

    it('handles multiple dollar amounts in the same content', () => {
      const content = 'Items cost $100, $200, and $350 respectively'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$100')
      expect(text).toContain('$200')
      expect(text).toContain('$350')
    })

    it('handles single digit dollar amounts', () => {
      const content = 'Only $5 or $9 available'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$5')
      expect(text).toContain('$9')
    })

    it('handles large dollar amounts', () => {
      const content = 'The total is $1000000 for the project'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$1000000')
    })

    it('preserves dollar amounts in sentences with mixed content', () => {
      const content = 'I paid $50 yesterday and will pay $75 tomorrow.'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$50')
      expect(text).toContain('$75')
    })

    it('does not interfere with actual LaTeX inline math', () => {
      const content = 'The equation $x + y = z$ is simple'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // LaTeX should be rendered (KaTeX will process it)
      expect(markdownContainer).toBeTruthy()
    })

    it('does not interfere with display math blocks', () => {
      const content = '$$\nx^2 + y^2 = r^2\n$$'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Display math should be rendered
      expect(markdownContainer).toBeTruthy()
    })
  })

  it('does not format 4-space indented text as code blocks', () => {
    const contentWithIndentedText = `Please explain this code block.

    <!DOCTYPE html>
    <html lang="en">
    <body>
        <header>
            <h1>Welcome to My Website</h1>
            <p>A sample HTML document showcasing various HTML elements</p>
        </header>
        
        <nav>
            <a href="#home">Home</a>
            <a href="#about">About</a>
            <a href="#services">Services</a>
            <a href="#contact">Contact</a>
        </nav>
        
        <div class="container">
            <section id="home">
                <h2>Home</h2>
                <div class="card">
                    <p>This is a sample HTML document that demonstrates various HTML elements and their structure.</p>
                    <p>HTML (HyperText Markup Language) is the standard markup language for creating web pages.</p>
                </div>
            </section>
            
        </div>
        
        <footer>
            <p>&copy; ${new Date().getFullYear()} My Sample Website. All rights reserved.</p>
        </footer>
    </body>
    </html>
    `
    render(
      <RenderMarkdown
        content={contentWithIndentedText}
      />
    )
    const markdownContainer = document.querySelector('.markdown')
    const html = markdownContainer?.innerHTML || ''
    expect(html).not.toContain('<pre>')
    expect(html).toContain('<p>')
    // Left and right brackets get escaped as &lt; and &gt; respectively
    expect(html).toContain('&lt;!DOCTYPE html&gt;')
  })
  
  it('formats fenced code blocks correctly', async () => {
    const contentWithFencedCodeBlock = `Please explain this code block.

\`\`\`html
<!DOCTYPE html>
<html lang="en">
<body>
    <header>
        <h1>Welcome to My Website</h1>
        <p>A sample HTML document showcasing various HTML elements</p>
    </header>

    <nav>
        <a href="#home">Home</a>
        <a href="#about">About</a>
        <a href="#services">Services</a>
        <a href="#contact">Contact</a>
    </nav>

    <div class="container">
        <section id="home">
            <h2>Home</h2>
            <div class="card">
                <p>This is a sample HTML document that demonstrates various HTML elements and their structure.</p>
                <p>HTML (HyperText Markup Language) is the standard markup language for creating web pages.</p>
            </div>
        </section>
    </div>

    <footer>
        <p>&copy; ${new Date().getFullYear()} My Sample Website. All rights reserved.</p>
    </footer>
</body>
</html>
\`\`\`
`
    const { container } = render(
      <RenderMarkdown
        content={contentWithFencedCodeBlock}
      />
    )
    const markdownContainer = container.querySelector('.markdown')
    expect(markdownContainer).toBeTruthy()
    const html = markdownContainer?.innerHTML ?? ''
    expect(html).toContain('&lt;!DOCTYPE html&gt;')
    await waitForSyntaxHighlight(container)
  })

  it('renders fenced code blocks with language and exactly one copy control', async () => {
    const content = 'Example:\n\n```typescript\nconst x: number = 1\n```\n'
    const { container } = render(<RenderMarkdown content={content} />)
    const markdown = container.querySelector('.markdown')
    expect(markdown).toBeTruthy()

    // Wait for Streamdown async code plugin / highlighter if needed
    await vi.waitFor(
      () => {
        const block = container.querySelector(
          '[data-streamdown="code-block"]'
        )
        expect(block).toBeTruthy()
      },
      { timeout: 5000 }
    )

    const block = container.querySelector('[data-streamdown="code-block"]')
    expect(block).toBeTruthy()
    const header = container.querySelector(
      '[data-streamdown="code-block-header"]'
    )
    expect(header).toBeTruthy()
    const headerText = header?.textContent?.toLowerCase() ?? ''
    expect(headerText).toMatch(/typescript|ts/)

    const actions = container.querySelector(
      '[data-streamdown="code-block-actions"]'
    )
    expect(actions).toBeTruthy()
    expect(
      screen.getAllByRole('button', { name: 'Copy code' })
    ).toHaveLength(1)

    await waitForSyntaxHighlight(container)
  })

  it('copies the complete fenced code from the top-right control', async () => {
    const content = '```python\nprint("hello")\nprint("world")\n```'
    const { container } = render(<RenderMarkdown content={content} />)

    await vi.waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Copy code' })
      ).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    })

    await vi.waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'print("hello")\nprint("world")'
      )
    })
    await waitForSyntaxHighlight(container)
  })

  it('reliably expands and collapses long fenced code blocks', async () => {
    const longCode = Array.from(
      { length: 24 },
      (_, index) => `const line${index + 1} = ${index + 1}`
    ).join('\n')
    const { container } = render(
      <RenderMarkdown content={`\`\`\`typescript\n${longCode}\n\`\`\``} />
    )

    await vi.waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Expand code' })
      ).toBeInTheDocument()
    })
    await waitForSyntaxHighlight(container)

    const body = container.querySelector(
      '[data-streamdown="code-block-body"]'
    )
    expect(body).toHaveAttribute('data-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Expand code' }))
    expect(body).toHaveAttribute('data-expanded', 'true')
    expect(
      screen.getByRole('button', { name: 'Collapse code' })
    ).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse code' }))
    expect(body).toHaveAttribute('data-expanded', 'false')
  })

  it('does not show an expand control for short fenced code blocks', async () => {
    const { container } = render(
      <RenderMarkdown content={'```javascript\nconst x = 1\n```'} />
    )

    await vi.waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Copy code' })
      ).toBeInTheDocument()
    })

    expect(
      screen.queryByRole('button', { name: 'Expand code' })
    ).not.toBeInTheDocument()
    await waitForSyntaxHighlight(container)
  })

  it('leaves inline code unaffected by fenced code-block chrome', () => {
    const content = 'Use the `inline_token` value.'
    const { container } = render(<RenderMarkdown content={content} />)
    const markdown = container.querySelector('.markdown')
    expect(markdown).toBeTruthy()
    expect(markdown?.textContent).toContain('inline_token')
    expect(
      container.querySelector('[data-streamdown="code-block"]')
    ).toBeNull()
    const code = container.querySelector('code')
    expect(code).toBeTruthy()
    expect(code?.textContent).toContain('inline_token')
  })
  describe('LaTeX normalization - display math', () => {
    it('converts \\[...\\] to $$ display math', () => {
      const content = 'Here is math:\n\\[\nx^2 + y^2\n\\]\nDone'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Display math should be rendered by KaTeX
      expect(markdownContainer).toBeTruthy()
    })
  })

  describe('LaTeX normalization - inline math', () => {
    it('converts \\(...\\) to $ inline math', () => {
      const content = 'The formula \\(E = mc^2\\) is famous'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Inline math should be rendered
      expect(markdownContainer).toBeTruthy()
    })
  })

  describe('LaTeX normalization - code block preservation', () => {
    it('does not process dollar amounts inside code blocks', () => {
      const content = '```\nconst price = $100\n```'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      // Code blocks should preserve original content
      expect(markdownContainer).toBeTruthy()
    })

    it('does not process dollar amounts inside inline code', () => {
      const content = 'Use `$100` in the variable'
      render(<RenderMarkdown content={content} />)
      const markdownContainer = document.querySelector('.markdown')
      const text = markdownContainer?.textContent || ''
      expect(text).toContain('$100')
    })
  })
})
