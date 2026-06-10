import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services', () => ({
  ServiceHub: class ServiceHub {},
}))
vi.unmock('@/hooks/useServiceHub')

import {
  getServiceHub,
  initializeServiceHubStore,
  isServiceHubInitialized,
  useServiceHub,
  useServiceStore,
} from '../useServiceHub'

describe('useServiceHub store helpers', () => {
  const serviceHub = { app: () => ({}) } as any

  beforeEach(() => {
    useServiceStore.setState({ serviceHub: null })
  })

  it('tracks whether the service hub is initialized', () => {
    expect(isServiceHubInitialized()).toBe(false)

    initializeServiceHubStore(serviceHub)

    expect(isServiceHubInitialized()).toBe(true)
    expect(getServiceHub()).toBe(serviceHub)
  })

  it('throws from non-React access when service hub is missing', () => {
    expect(() => getServiceHub()).toThrow('ServiceHub not initialized')
  })

  it('throws from the hook when service hub is missing', () => {
    const { result } = renderHook(() => {
      try {
        return useServiceHub()
      } catch (error) {
        return error
      }
    })

    expect(result.current).toBeInstanceOf(Error)
  })

  it('returns the initialized service hub from the hook', () => {
    initializeServiceHubStore(serviceHub)

    const { result } = renderHook(() => useServiceHub())

    expect(result.current).toBe(serviceHub)
  })
})
