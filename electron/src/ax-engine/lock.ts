// Cross-process advisory lock for ax-engine lifecycle operations.
// No npm deps: exclusive-create (`wx`) file + pid liveness, so a lock left
// behind by a crashed app is reclaimed instead of deadlocking the next run.
import fs from 'node:fs'
import path from 'node:path'
import { serverLockPath } from './paths.js'

const LOCK_STALE_MS = 10 * 60 * 1000

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but is owned by someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: unknown }
    return typeof parsed.pid === 'number' ? parsed.pid : null
  } catch {
    return null
  }
}

function isLockStale(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath)
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) return true
  } catch {
    return true
  }
  const pid = readLockPid(lockPath)
  return pid === null || !isPidAlive(pid)
}

/**
 * Acquire the lock, breaking it when the holder is gone. Retries briefly so a
 * concurrent lifecycle op in another window/process finishes first.
 */
export async function acquireAxEngineLock(timeoutMs = 15_000): Promise<() => void> {
  const lockPath = serverLockPath()
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx')
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      fs.closeSync(fd)
      let released = false
      return () => {
        if (released) return
        released = true
        try {
          fs.unlinkSync(lockPath)
        } catch {
          /* already gone */
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (isLockStale(lockPath)) {
        try {
          fs.unlinkSync(lockPath)
        } catch {
          /* raced with another breaker; retry */
        }
        continue
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the ax-engine server lock (held by a live process).')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}
