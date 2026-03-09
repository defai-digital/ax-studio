/**
 * Shared result type for bootstrap units.
 * Each bootstrap function returns BootstrapResult so DataProvider
 * can handle per-subsystem failures independently.
 */
export type BootstrapResult = { ok: true } | { ok: false; error: unknown }

export function ok(): BootstrapResult {
  return { ok: true }
}

export function fail(error: unknown): BootstrapResult {
  return { ok: false, error }
}
