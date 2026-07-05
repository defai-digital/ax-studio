import { describe, expect, it } from 'vitest'
import {
  LOG_EVENT_NAME,
  SERVER_PROXY_LOG_TARGET,
  formatLogTimestamp,
  getLogLevelColor,
} from '../log-display'

describe('log display helpers', () => {
  it('formats timestamps as UTC time', () => {
    expect(formatLogTimestamp('2025-01-02T03:04:05.000Z')).toBe('03:04:05')
    expect(formatLogTimestamp(Date.UTC(2025, 0, 2, 23, 59, 58))).toBe(
      '23:59:58'
    )
  })

  it('maps known log levels to display classes', () => {
    expect(getLogLevelColor('error')).toBe('text-red-500')
    expect(getLogLevelColor('warn')).toBe('text-yellow-500')
    expect(getLogLevelColor('info')).toBe('text-blue-500')
    expect(getLogLevelColor('debug')).toBe('text-gray-500')
    expect(getLogLevelColor('trace')).toBe('text-gray-500')
  })

  it('exposes shared server log subscription constants', () => {
    expect(SERVER_PROXY_LOG_TARGET).toBe('app_lib::core::server::proxy')
    expect(LOG_EVENT_NAME).toBe('log://log')
  })
})
