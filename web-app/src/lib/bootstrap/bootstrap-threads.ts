/**
 * bootstrap-threads — preloads threads from the backend into local state.
 * Pure async function; no React, no Zustand imports.
 */
import type { ServiceHub } from '@/services/index'
import { type BootstrapResult, ok, fail } from './bootstrap-result'

export type BootstrapThreadsInput = {
  serviceHub: ServiceHub
  setThreads: (threads: Thread[]) => void
  isCancelled?: () => boolean
}

export async function bootstrapThreads(
  input: BootstrapThreadsInput
): Promise<BootstrapResult> {
  const { serviceHub, setThreads, isCancelled = () => false } = input
  try {
    const threads = await serviceHub.threads().fetchThreads()
    if (!isCancelled()) setThreads(threads)
    return ok()
  } catch (error) {
    console.error('bootstrapThreads failed:', error)
    return fail(error)
  }
}
