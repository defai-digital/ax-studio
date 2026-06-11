import { beforeEach, describe, expect, it } from 'vitest'

import { useSearchDialog } from '../useSearchDialog'

describe('useSearchDialog', () => {
  beforeEach(() => {
    useSearchDialog.setState({ open: false })
  })

  it('stores search dialog open state', () => {
    expect(useSearchDialog.getState().open).toBe(false)

    useSearchDialog.getState().setOpen(true)

    expect(useSearchDialog.getState().open).toBe(true)
  })
})
