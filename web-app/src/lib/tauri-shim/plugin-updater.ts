// Electron shim for @tauri-apps/plugin-updater — see docs/architecture/electron-migration-phase0-matrix.md
//
// Phase 4: the Electron updater UI (containers/ElectronUpdateBanner.tsx) talks
// to electron-updater in the main process via the `updater_*` IPC commands, so
// nothing under Electron calls this shim. `check()` keeps reporting "no
// update" for any legacy caller instead of breaking.

export interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished'
  data: { contentLength?: number; chunkLength?: number }
}

export class Update {
  constructor(
    readonly version: string,
    readonly body?: string
  ) {}

  async downloadAndInstall(
    _onEvent?: (progress: DownloadEvent) => void
  ): Promise<void> {
    throw new Error('unimplemented_command: plugin-updater downloadAndInstall (phase-4)')
  }
}

export async function check(): Promise<Update | null> {
  return null
}
