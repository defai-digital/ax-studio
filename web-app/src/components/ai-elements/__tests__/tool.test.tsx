import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../code-block', () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) => (
    <pre data-testid="code-block" data-language={language}>
      {code}
    </pre>
  ),
}))

import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '../tool'
import { useTool } from '../tool-context'

describe('Tool', () => {
  it('renders children inside a collapsible', () => {
    render(
      <Tool state="output-available">
        <div data-testid="tool-child">Content</div>
      </Tool>
    )
    expect(screen.getByTestId('tool-child')).toBeInTheDocument()
  })

  it('is closed by default (defaultOpen=false)', () => {
    const { container } = render(
      <Tool state="output-available">
        <div>child</div>
      </Tool>
    )
    const collapsible = container.firstChild as HTMLElement
    expect(collapsible.getAttribute('data-state')).toBe('closed')
  })

  it('is open when defaultOpen=true', () => {
    const { container } = render(
      <Tool state="output-available" defaultOpen={true}>
        <div>child</div>
      </Tool>
    )
    const collapsible = container.firstChild as HTMLElement
    expect(collapsible.getAttribute('data-state')).toBe('open')
  })

  it('applies custom className', () => {
    const { container } = render(
      <Tool state="output-available" className="my-tool-class">
        <div>child</div>
      </Tool>
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('my-tool-class')
    expect(el.className).toContain('not-prose')
  })
})

describe('ToolHeader', () => {
  it('shows "running" badge when state is input-streaming', () => {
    render(
      <Tool state="input-streaming" defaultOpen={true}>
        <ToolHeader
          title="my_tool"
          state="input-streaming"
          type="tool-my_tool"
        />
      </Tool>
    )
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('shows "running" badge when state is input-available', () => {
    render(
      <Tool state="input-available" defaultOpen={true}>
        <ToolHeader
          title="search"
          state="input-available"
          type="tool-search"
        />
      </Tool>
    )
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('shows "completed" badge when state is output-available', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolHeader
          title="fetch"
          state="output-available"
          type="tool-fetch"
        />
      </Tool>
    )
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  it('shows "failed" badge when state is output-error', () => {
    render(
      <Tool state="output-error" defaultOpen={true}>
        <ToolHeader
          title="broken"
          state="output-error"
          type="tool-broken"
        />
      </Tool>
    )
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('derives tool name from type when title is not provided', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolHeader
          state="output-available"
          type="tool-web-search"
        />
      </Tool>
    )
    // type is "tool-web-search", splitting by '-' and dropping first gives "web-search"
    // then replaceAll('_', ' ') leaves hyphens intact
    expect(screen.getByText('web-search')).toBeInTheDocument()
  })

  it('replaces underscores with spaces in tool name', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolHeader
          title="get_weather_data"
          state="output-available"
          type="tool-get_weather_data"
        />
      </Tool>
    )
    expect(screen.getByText('get weather data')).toBeInTheDocument()
  })
})

describe('ToolInput', () => {
  it('renders parameters heading', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolInput input={{ query: 'test' }} />
        </ToolContent>
      </Tool>
    )
    expect(screen.getByText('Parameters')).toBeInTheDocument()
  })

  it('renders JSON-stringified input in a CodeBlock', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolInput input={{ key: 'value' }} />
        </ToolContent>
      </Tool>
    )
    const codeBlock = screen.getByTestId('code-block')
    expect(codeBlock.textContent).toContain('"key"')
    expect(codeBlock.textContent).toContain('"value"')
    expect(codeBlock.getAttribute('data-language')).toBe('json')
  })
})

describe('ToolOutput', () => {
  const resolver = (input: string) => Promise.resolve(input)

  it('returns null when output and errorText are both falsy', () => {
    const { container } = render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output={undefined} errorText={undefined} resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    expect(container.querySelector('.space-y-2.mt-4')).toBeNull()
  })

  it('renders "Result" heading for successful output', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output="some result" errorText={undefined} resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    expect(screen.getByText('Result')).toBeInTheDocument()
  })

  it('renders "Error" heading when errorText is present', () => {
    render(
      <Tool state="output-error" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output={undefined} errorText="Something failed" resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('Something failed')).toBeInTheDocument()
  })

  it('renders string output in a CodeBlock', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output="plain text result" errorText={undefined} resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    const codeBlock = screen.getByTestId('code-block')
    expect(codeBlock.textContent).toBe('plain text result')
  })

  it('renders object output as JSON in a CodeBlock', () => {
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput
            output={{ answer: 42 }}
            errorText={undefined}
            resolver={resolver}
          />
        </ToolContent>
      </Tool>
    )
    const codeBlock = screen.getByTestId('code-block')
    expect(codeBlock.textContent).toContain('"answer"')
    expect(codeBlock.textContent).toContain('42')
  })

  it('renders content array with text items', () => {
    const output = {
      content: [
        { type: 'text', text: 'Hello world' },
        { type: 'text', text: 'Second text' },
      ],
    }
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output={output} errorText={undefined} resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    const codeBlocks = screen.getAllByTestId('code-block')
    expect(codeBlocks[0].textContent).toBe('Hello world')
    expect(codeBlocks[1].textContent).toBe('Second text')
  })

  it('renders content array with image items', () => {
    const output = {
      content: [{ type: 'image', data: 'base64data' }],
    }
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output={output} errorText={undefined} resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    const img = screen.getByAltText('Tool output')
    expect(img.getAttribute('src')).toBe('data:image/png;base64,base64data')
  })

  it('renders array output as JSON', () => {
    const output = [{ id: 1 }, { id: 2 }]
    render(
      <Tool state="output-available" defaultOpen={true}>
        <ToolContent>
          <ToolOutput output={output} errorText={undefined} resolver={resolver} />
        </ToolContent>
      </Tool>
    )
    const codeBlock = screen.getByTestId('code-block')
    expect(codeBlock.textContent).toContain('"id"')
  })

  it('renders both errorText and output when both present', () => {
    render(
      <Tool state="output-error" defaultOpen={true}>
        <ToolContent>
          <ToolOutput
            output="partial result"
            errorText="Partial failure"
            resolver={resolver}
          />
        </ToolContent>
      </Tool>
    )
    expect(screen.getByText('Partial failure')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByTestId('code-block').textContent).toBe('partial result')
  })
})

describe('useTool', () => {
  it('throws when used outside Tool context', () => {
    const TestComponent = () => {
      useTool()
      return null
    }
    expect(() => render(<TestComponent />)).toThrow(
      'Tool components must be used within Tool'
    )
  })
})
