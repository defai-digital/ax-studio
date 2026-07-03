import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hideInitialLoader } from '../app-startup'

describe('hideInitialLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.className = ''
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('marks the app loaded and removes the initial loader after the transition', () => {
    document.body.innerHTML = '<div id="initial-loader"></div>'

    hideInitialLoader()

    expect(document.body).toHaveClass('loaded')
    expect(document.getElementById('initial-loader')).not.toBeNull()

    vi.advanceTimersByTime(300)

    expect(document.getElementById('initial-loader')).toBeNull()
  })

  it('ignores malformed loader lookups', () => {
    const getElementByIdSpy = vi
      .spyOn(document, 'getElementById')
      .mockReturnValue({ remove: undefined } as unknown as HTMLElement)

    hideInitialLoader()
    vi.advanceTimersByTime(300)

    expect(document.body).toHaveClass('loaded')
    expect(getElementByIdSpy).toHaveBeenCalledWith('initial-loader')
  })
})
