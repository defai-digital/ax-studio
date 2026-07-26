// Filesystem layout for the ax-engine sidecar. Mirrors AX Code's
// packages/ax-code/src/provider/ax-engine/paths.ts: everything lives under
// <data>/ax-engine/ — managed binary, server.json, server.lock, server.log.
import path from 'node:path'
import { getAppDataFolderPath } from '../state.js'

export function axEngineDir(): string {
  return path.join(getAppDataFolderPath(), 'ax-engine')
}

/** Managed-install binary location (auto-download is a TODO, see dependency.ts). */
export function managedBinaryPath(): string {
  return path.join(axEngineDir(), 'ax-engine')
}

export function serverRecordPath(): string {
  return path.join(axEngineDir(), 'server.json')
}

export function serverLockPath(): string {
  return path.join(axEngineDir(), 'server.lock')
}

export function serverLogPath(): string {
  return path.join(axEngineDir(), 'server.log')
}
