import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PythonCodeBlock } from '../PythonCodeBlock'

const mockExecute = vi.fn()
const mockReset = vi.fn()
let mockState: Record<string, unknown> = { status: 'idle' }

vi.mock('@/hooks/useCodeExecution', () => ({
  useCodeExecution: () => ({
    state: mockState,
    execute: mockExecute,
    reset: mockReset,
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('PythonCodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState = { status: 'idle' }
  })

  it('renders children and a Run button in idle state', () => {
    render(
      <PythonCodeBlock code="print('hi')">
        <pre>print('hi')</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText("print('hi')")).toBeInTheDocument()
    expect(screen.getByText('Run')).toBeInTheDocument()
  })

  it('calls execute with code when Run is clicked', async () => {
    const user = userEvent.setup()
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    await user.click(screen.getByText('Run'))
    expect(mockExecute).toHaveBeenCalledWith('x = 1')
  })

  it('shows Checking label when status is checking', () => {
    mockState = { status: 'checking' }
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('Checking…')).toBeInTheDocument()
  })

  it('shows Running label when status is running', () => {
    mockState = { status: 'running' }
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('Running…')).toBeInTheDocument()
  })

  it('shows Run again button when done', () => {
    mockState = {
      status: 'done',
      result: { stdout: 'hello', stderr: '', outputs: [], error: null },
    }
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('Run again')).toBeInTheDocument()
  })

  it('calls reset when Run again is clicked', async () => {
    mockState = {
      status: 'done',
      result: { stdout: '', stderr: '', outputs: [], error: null },
    }
    const user = userEvent.setup()
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    await user.click(screen.getByText('Run again'))
    expect(mockReset).toHaveBeenCalledTimes(1)
  })

  it('renders stdout output when done', () => {
    mockState = {
      status: 'done',
      result: {
        stdout: 'Hello World',
        stderr: '',
        outputs: [],
        error: null,
      },
    }
    render(
      <PythonCodeBlock code="print('Hello World')">
        <pre>code</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('Hello World')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
  })

  it('renders error output when stderr is present', () => {
    mockState = {
      status: 'done',
      result: {
        stdout: '',
        stderr: 'NameError: name x is not defined',
        outputs: [],
        error: null,
      },
    }
    render(
      <PythonCodeBlock code="print(x)">
        <pre>code</pre>
      </PythonCodeBlock>
    )

    expect(
      screen.getByText('NameError: name x is not defined')
    ).toBeInTheDocument()
  })

  it('shows No output when result has no stdout, outputs, or errors', () => {
    mockState = {
      status: 'done',
      result: { stdout: '', stderr: '', outputs: [], error: null },
    }
    render(
      <PythonCodeBlock code="pass">
        <pre>code</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('No output')).toBeInTheDocument()
  })

  it('shows python unavailable warning', () => {
    mockState = { status: 'python_unavailable' }
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    expect(
      screen.getByText(/Python is not installed or not in PATH/)
    ).toBeInTheDocument()
  })

  it('shows error message when status is error', () => {
    mockState = { status: 'error', message: 'Sandbox crashed' }
    render(
      <PythonCodeBlock code="x = 1">
        <pre>x = 1</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('Sandbox crashed')).toBeInTheDocument()
  })

  it('renders text outputs', () => {
    mockState = {
      status: 'done',
      result: {
        stdout: '',
        stderr: '',
        outputs: [{ type: 'text', data: 'plain text result' }],
        error: null,
      },
    }
    render(
      <PythonCodeBlock code="x">
        <pre>code</pre>
      </PythonCodeBlock>
    )

    expect(screen.getByText('plain text result')).toBeInTheDocument()
  })

  it('renders image outputs with correct src', () => {
    mockState = {
      status: 'done',
      result: {
        stdout: '',
        stderr: '',
        outputs: [{ type: 'image', data: 'abc123' }],
        error: null,
      },
    }
    render(
      <PythonCodeBlock code="plt.show()">
        <pre>code</pre>
      </PythonCodeBlock>
    )

    const img = screen.getByAltText('Figure 1')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123')
  })
})
