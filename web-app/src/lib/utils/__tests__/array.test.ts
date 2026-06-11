import { describe, expect, it } from 'vitest'
import { appendUniqueString, pushUniqueNormalizedString, uniqueStrings } from '../array'

describe('array utils', () => {
  it('deduplicates strings while preserving first-seen order', () => {
    expect(uniqueStrings(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })

  it('appends only missing strings', () => {
    expect(appendUniqueString(['a'], 'b')).toEqual(['a', 'b'])
    expect(appendUniqueString(['a'], 'a')).toEqual(['a'])
  })

  it('pushes normalized strings only once', () => {
    const values = ['a b']

    pushUniqueNormalizedString(values, '  a   b ')
    pushUniqueNormalizedString(values, 'c')

    expect(values).toEqual(['a b', 'c'])
  })
})
