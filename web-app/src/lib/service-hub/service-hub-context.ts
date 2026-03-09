/**
 * React-boundary ServiceHub access.
 *
 * Use `useServiceHubContext()` inside React components and hooks.
 * The hook reads from the Zustand store and throws if called before
 * the hub is initialized, so startup failures surface as React errors
 * rather than silent crashes.
 *
 * For non-React contexts (Zustand store actions, bootstrap modules,
 * transport factories) use `getServiceHub` from service-hub-registry.ts.
 */
export { useServiceHub as useServiceHubContext } from '@/hooks/useServiceHub'
