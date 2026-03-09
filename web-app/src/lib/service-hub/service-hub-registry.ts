/**
 * Non-React ServiceHub singleton access.
 *
 * Use `getServiceHub()` ONLY in:
 *   - Zustand store action bodies
 *   - lib/bootstrap/* startup modules
 *   - lib/transport/* (non-React transport logic)
 *   - useServiceHub.ts itself (provider initialization)
 *
 * React components and hooks must use `useServiceHubContext()`
 * from service-hub-context.ts instead.
 */
export { getServiceHub } from '@/hooks/useServiceHub'
