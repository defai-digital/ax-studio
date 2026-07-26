// Electron shim for @tauri-apps/plugin-http — see docs/architecture/electron-migration-phase0-matrix.md
//
// tauri-plugin-http executes requests in Rust, bypassing CORS entirely.
// Electron renderer fetch is a real browser fetch: requests to origins that
// do not send CORS headers (e.g. a local inference server on 127.0.0.1) will
// be blocked. Callers in this repo only use it for localhost/loopback
// endpoints and remote providers that already send CORS headers, so a thin
// passthrough is correct for Phase 1. TODO(phase-2): route non-CORS-safe
// requests through an IPC-backed fetch in the main process if needed.

export const fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
