import { describe, expect, it } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { Route } from '../index'

describe('/settings index route', () => {
  it('redirects to /settings/general', () => {
    const beforeLoad = (
      Route as unknown as { options: { beforeLoad: () => void } }
    ).options.beforeLoad

    let thrown: unknown
    try {
      beforeLoad()
    } catch (err) {
      thrown = err
    }

    expect(isRedirect(thrown)).toBe(true)
    expect((thrown as { options?: { to?: string } }).options?.to).toBe(
      '/settings/general'
    )
  })
})
