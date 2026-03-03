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

export type ExecutionState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: ExecutionResult }
  | { status: 'error'; message: string }

export function useCodeExecution() {
  const [state, setState] = useState<ExecutionState>({ status: 'idle' })

  const execute = useCallback(async (code: string) => {
    setState({ status: 'running' })
    try {
      const result = await invoke<ExecutionResult>('execute_python_code', { code })
      setState({ status: 'done', result })
    } catch (err) {
      setState({ status: 'error', message: String(err) })
    }
  }, [])

  const reset = useCallback(() => {
    setState({ status: 'idle' })
  }, [])

  return { state, execute, reset }
}
