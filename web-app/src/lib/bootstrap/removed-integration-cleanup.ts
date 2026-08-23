import { deleteSecureSecret } from '@/lib/storage/secure-secret'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'

/**
 * One-shot cleanup of state left behind by the removed AX BI integration.
 *
 * Installs that had connected to AX BI still hold an MCP bearer token in the
 * desktop secure credential store plus a handful of `localStorage` keys. The
 * feature is gone, so nothing will ever read them again — drop them instead of
 * leaving an orphaned credential on disk.
 *
 * Safe to delete once shipped builds have had a release or two to run it.
 */
const CLEANUP_DONE_KEY = 'ax-bi-removal-cleanup-done'

/** Secure-secret key formerly exported as `AX_BI_MCP_TOKEN_SECRET`. */
const REMOVED_SECRET_KEY = 'ax-bi-mcp-token'

/** Keys formerly declared in `constants/localStorage.ts`. */
const REMOVED_STORAGE_KEYS = [
  'ax-bi-sessions',
  'ax-bi-mcp-token',
  'ax-bi-mcp-url-override',
  'ax-bi-last-dataset',
]

export async function cleanupRemovedIntegrations(): Promise<void> {
  const context = 'removed-integration-cleanup'
  if (safeStorageGetItem(localStorage, CLEANUP_DONE_KEY, context) === '1') {
    return
  }

  for (const key of REMOVED_STORAGE_KEYS) {
    safeStorageRemoveItem(localStorage, key, context)
  }

  try {
    await deleteSecureSecret(REMOVED_SECRET_KEY)
  } catch (error) {
    // A failed delete is not worth blocking startup — retry on the next boot
    // by leaving the done-flag unset.
    console.warn('[cleanup] failed to drop the removed AX BI token:', error)
    return
  }

  safeStorageSetItem(localStorage, CLEANUP_DONE_KEY, '1', context)
}
