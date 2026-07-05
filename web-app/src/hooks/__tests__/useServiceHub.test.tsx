import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceHub } from '@/services'

vi.mock('@/services', () => ({
  ServiceHub: class ServiceHub {},
}))
vi.unmock('@/hooks/useServiceHub')

import {
  getServiceHub,
  initializeServiceHubStore,
  useServiceHub,
  useServiceStore,
} from '../useServiceHub'

describe('useServiceHub store helpers', () => {
  const serviceHub = {
    app: () => ({}),
  } as Pick<ServiceHub, 'app'> as ServiceHub

  beforeEach(() => {
    useServiceStore.setState({ serviceHub: null })
  })

  it('tracks whether the service hub is initialized', () => {
    expect(useServiceStore.getState().serviceHub).toBeNull()

    initializeServiceHubStore(serviceHub)

    expect(useServiceStore.getState().serviceHub).toBe(serviceHub)
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
