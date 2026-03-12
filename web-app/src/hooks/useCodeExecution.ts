import { invoke } from '@tauri-apps/api/core'
import { useState, useCallback } from 'react'

export type OutputItem =
  | { type: 'image'; data: string }
  | { type: 'html'; data: string }
  | { type: 'text'; data: string }

export type ExecutionResult = {
  stdout: string
  stderr: string
  outputs: OutputItem[]
  error: string | null
}

export type SandboxStatus = {
  pythonAvailable: boolean
}

export type ExecutionState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'running' }
  | { status: 'done'; result: ExecutionResult }
  | { status: 'python_unavailable' }
  | { status: 'error'; message: string }

export function useCodeExecution(threadId?: string) {
  const [state, setState] = useState<ExecutionState>({ status: 'idle' })

  const execute = useCallback(async (code: string) => {
    setState({ status: 'checking' })

    try {
      const status = await invoke<SandboxStatus>('check_sandbox_status')

      if (!status.pythonAvailable) {
        setState({ status: 'python_unavailable' })
        return
      }

      setState({ status: 'running' })
      const result = await invoke<ExecutionResult>('execute_python_code', {
        code,
        threadId: threadId ?? null,
      })
      console.log('[CEE] execution result:', JSON.stringify({ stdout: result.stdout?.slice(0, 100), stderr: result.stderr?.slice(0, 100), outputs: result.outputs?.length, error: result.error }))
      setState({ status: 'done', result })
    } catch (err) {
      setState({ status: 'error', message: String(err) })
    }
  }, [threadId])

  const reset = useCallback(() => {
    setState({ status: 'idle' })
  }, [])

  const resetSession = useCallback(async () => {
    await invoke('reset_sandbox_session', { threadId: threadId ?? null })
    setState({ status: 'idle' })
  }, [threadId])

  return { state, execute, reset, resetSession }
}
