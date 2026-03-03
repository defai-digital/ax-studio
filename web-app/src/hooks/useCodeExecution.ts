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
  dockerAvailable: boolean
  sandboxReady: boolean
  sandboxUrl: string
  debugInfo: string
}

export type ExecutionState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'starting_sandbox' }
  | { status: 'running' }
  | { status: 'done'; result: ExecutionResult }
  | { status: 'sandbox_unavailable'; dockerAvailable: boolean }
  | { status: 'error'; message: string }

export function useCodeExecution(threadId?: string) {
  const [state, setState] = useState<ExecutionState>({ status: 'idle' })

  const execute = useCallback(async (code: string) => {
    setState({ status: 'checking' })

    try {
      const status = await invoke<SandboxStatus>('check_sandbox_status')
      console.log('[CEE] sandbox status:', status.debugInfo)

      if (!status.sandboxReady) {
        if (!status.dockerAvailable) {
          setState({ status: 'sandbox_unavailable', dockerAvailable: false })
          return
        }
        // Docker is available but sandbox is not running — auto-start it
        setState({ status: 'starting_sandbox' })
        await invoke('start_sandbox')
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
