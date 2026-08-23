import { describe, it, expect } from 'vitest'
import { isMissingRunningServerError } from '../deactivate-errors'

describe('isMissingRunningServerError', () => {
  it('matches Server not found errors from the backend', () => {
    expect(
      isMissingRunningServerError(new Error('Server beta not found'))
    ).toBe(true)
    expect(isMissingRunningServerError('Server alpha not found')).toBe(true)
  })

  it('matches not connected / not running phrasing', () => {
    expect(isMissingRunningServerError(new Error('not connected'))).toBe(true)
    expect(isMissingRunningServerError('Server is not running')).toBe(true)
  })

  it('does not match real stop failures', () => {
    expect(isMissingRunningServerError(new Error('stop failed'))).toBe(false)
    expect(isMissingRunningServerError('permission denied')).toBe(false)
    expect(isMissingRunningServerError(new Error('timeout'))).toBe(false)
  })
})
