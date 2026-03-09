import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentHealthMonitor } from '../agent-health-monitor'

describe('AgentHealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shouldCall() returns true for unknown agents', () => {
    const monitor = new AgentHealthMonitor()
    expect(monitor.shouldCall('agent-1')).toBe(true)
  })

  it('shouldCall() returns true after single failure', () => {
    const monitor = new AgentHealthMonitor()
    monitor.recordFailure('agent-1')
    expect(monitor.shouldCall('agent-1')).toBe(true)
  })

  it('shouldCall() returns false after 2 failures (circuit opens)', () => {
    const monitor = new AgentHealthMonitor()
    monitor.recordFailure('agent-1')
    monitor.recordFailure('agent-1')
    expect(monitor.shouldCall('agent-1')).toBe(false)
  })

  it('shouldCall() returns true after reset timeout (probe allowed)', () => {
    const monitor = new AgentHealthMonitor()
    monitor.recordFailure('agent-1')
    monitor.recordFailure('agent-1')
    expect(monitor.shouldCall('agent-1')).toBe(false)

    // Advance past reset timeout (30s)
    vi.advanceTimersByTime(31000)
    expect(monitor.shouldCall('agent-1')).toBe(true) // half-open
  })

  it('recordSuccess() resets circuit to closed', () => {
    const monitor = new AgentHealthMonitor()
    monitor.recordFailure('agent-1')
    monitor.recordFailure('agent-1')
    expect(monitor.shouldCall('agent-1')).toBe(false)

    // Advance past reset timeout, probe, then record success
    vi.advanceTimersByTime(31000)
    monitor.shouldCall('agent-1') // allows probe
    monitor.recordSuccess('agent-1')

    expect(monitor.shouldCall('agent-1')).toBe(true)
    expect(monitor.getStatus('agent-1')).toBe('healthy')
  })

  it('getStatus() returns correct states', () => {
    const monitor = new AgentHealthMonitor()
    expect(monitor.getStatus('agent-1')).toBe('healthy')

    monitor.recordFailure('agent-1')
    monitor.recordFailure('agent-1')
    expect(monitor.getStatus('agent-1')).toBe('unavailable')

    // After reset timeout, shouldCall transitions circuit to half-open (probe allowed)
    vi.advanceTimersByTime(31000)
    monitor.shouldCall('agent-1') // transitions to half-open
    expect(monitor.getStatus('agent-1')).toBe('degraded')

    // After successful probe, circuit closes
    monitor.recordSuccess('agent-1')
    expect(monitor.getStatus('agent-1')).toBe('healthy')
  })

  it('tracks multiple agents independently', () => {
    const monitor = new AgentHealthMonitor()
    monitor.recordFailure('agent-1')
    monitor.recordFailure('agent-1')
    monitor.recordFailure('agent-2')

    expect(monitor.shouldCall('agent-1')).toBe(false)
    expect(monitor.shouldCall('agent-2')).toBe(true)
  })
})
