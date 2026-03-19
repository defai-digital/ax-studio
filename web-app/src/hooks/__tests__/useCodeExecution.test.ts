import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { useCodeExecution } from '../useCodeExecution'
import type { ExecutionResult, SandboxStatus } from '../useCodeExecution'

describe('useCodeExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with idle state', () => {
    const { result } = renderHook(() => useCodeExecution())

    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('should transition idle -> checking -> running -> done on successful execution', async () => {
    const sandboxStatus: SandboxStatus = { pythonAvailable: true }
    const execResult: ExecutionResult = {
      stdout: 'Hello world',
      stderr: '',
      outputs: [],
      error: null,
    }

    mockInvoke
      .mockResolvedValueOnce(sandboxStatus)
      .mockResolvedValueOnce(execResult)

    const { result } = renderHook(() => useCodeExecution('thread-1'))

    await act(async () => {
      await result.current.execute('print("Hello world")')
    })

    expect(result.current.state).toEqual({ status: 'done', result: execResult })

    // Verify invoke was called with correct commands
    expect(mockInvoke).toHaveBeenCalledWith('check_sandbox_status')
    expect(mockInvoke).toHaveBeenCalledWith('execute_python_code', {
      code: 'print("Hello world")',
      threadId: 'thread-1',
    })
  })

  it('should transition to python_unavailable when python is not available', async () => {
    const sandboxStatus: SandboxStatus = { pythonAvailable: false }
    mockInvoke.mockResolvedValueOnce(sandboxStatus)

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('print("test")')
    })

    expect(result.current.state).toEqual({ status: 'python_unavailable' })
    // Should not have called execute_python_code
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('should transition to error state on sandbox check failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Sandbox check failed'))

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('print("test")')
    })

    expect(result.current.state).toEqual({
      status: 'error',
      message: 'Error: Sandbox check failed',
    })
  })

  it('should transition to error state on execution failure', async () => {
    mockInvoke
      .mockResolvedValueOnce({ pythonAvailable: true })
      .mockRejectedValueOnce(new Error('Execution timeout'))

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('while True: pass')
    })

    expect(result.current.state).toEqual({
      status: 'error',
      message: 'Error: Execution timeout',
    })
  })

  it('should reset state to idle', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('fail'))

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('code')
    })

    expect(result.current.state.status).toBe('error')

    act(() => {
      result.current.reset()
    })

    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('should reset session and return to idle', async () => {
    mockInvoke.mockResolvedValue(undefined)

    const { result } = renderHook(() => useCodeExecution('thread-42'))

    await act(async () => {
      await result.current.resetSession()
    })

    expect(mockInvoke).toHaveBeenCalledWith('reset_sandbox_session', {
      threadId: 'thread-42',
    })
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('should pass null threadId when no threadId provided', async () => {
    mockInvoke
      .mockResolvedValueOnce({ pythonAvailable: true })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        outputs: [],
        error: null,
      })

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('x = 1')
    })

    expect(mockInvoke).toHaveBeenCalledWith('execute_python_code', {
      code: 'x = 1',
      threadId: null,
    })
  })

  it('should handle execution result with outputs', async () => {
    const execResult: ExecutionResult = {
      stdout: '',
      stderr: '',
      outputs: [
        { type: 'image', data: 'base64data' },
        { type: 'html', data: '<p>rendered</p>' },
        { type: 'text', data: 'plain output' },
      ],
      error: null,
    }

    mockInvoke
      .mockResolvedValueOnce({ pythonAvailable: true })
      .mockResolvedValueOnce(execResult)

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('import matplotlib')
    })

    expect(result.current.state.status).toBe('done')
    if (result.current.state.status === 'done') {
      expect(result.current.state.result.outputs).toHaveLength(3)
      expect(result.current.state.result.outputs[0]).toEqual({
        type: 'image',
        data: 'base64data',
      })
    }
  })

  it('should pass null threadId in resetSession when no threadId provided', async () => {
    mockInvoke.mockResolvedValue(undefined)

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.resetSession()
    })

    expect(mockInvoke).toHaveBeenCalledWith('reset_sandbox_session', {
      threadId: null,
    })
  })

  it('should handle non-Error thrown values in execute', async () => {
    mockInvoke.mockRejectedValueOnce('string error')

    const { result } = renderHook(() => useCodeExecution())

    await act(async () => {
      await result.current.execute('bad code')
    })

    expect(result.current.state).toEqual({
      status: 'error',
      message: 'string error',
    })
  })
})
