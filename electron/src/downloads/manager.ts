// Download task registry and cancellation primitives.
// Node port of DownloadManagerState in src-tauri/src/core/downloads/models.rs.

const MAX_ACTIVE_DOWNLOAD_TASKS = 16

/** tokio_util CancellationToken analogue: flag + sync listener fan-out. */
export class DownloadCancelToken {
  private listeners = new Set<() => void>()
  cancelled = false

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const listener of [...this.listeners]) listener()
  }

  /** Register a cancel hook; fires immediately when already cancelled. */
  onCancel(listener: () => void): () => void {
    if (this.cancelled) {
      listener()
      return () => {}
    }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

interface DownloadTaskState {
  token: DownloadCancelToken
  generation: number
  destinationKeys: string[]
}

export class DownloadManager {
  private tasks = new Map<string, DownloadTaskState>()
  private nextGeneration = 0

  registerTask(taskId: string, token: DownloadCancelToken, destinationKeys: string[]): number {
    if (this.tasks.has(taskId)) {
      throw new Error(`Download task '${taskId}' is already active`)
    }
    if (this.tasks.size >= MAX_ACTIVE_DOWNLOAD_TASKS) {
      throw new Error(`Too many active download tasks (maximum ${MAX_ACTIVE_DOWNLOAD_TASKS})`)
    }
    const conflict = destinationKeys.find((candidate) =>
      [...this.tasks.values()].some((task) => task.destinationKeys.includes(candidate))
    )
    if (conflict !== undefined) {
      throw new Error(`Another active download already owns destination '${conflict}'`)
    }
    this.nextGeneration += 1
    const generation = this.nextGeneration
    this.tasks.set(taskId, { token, generation, destinationKeys })
    return generation
  }

  finishTask(taskId: string, generation: number): void {
    const task = this.tasks.get(taskId)
    if (task !== undefined && task.generation === generation) {
      this.tasks.delete(taskId)
    }
  }

  getToken(taskId: string): DownloadCancelToken | undefined {
    return this.tasks.get(taskId)?.token
  }
}

export const downloadManager = new DownloadManager()
