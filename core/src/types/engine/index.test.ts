import { describe, it, expect } from 'vitest'
import { SecretString } from './index'

describe('SecretString', () => {
  it('should store and retrieve secret value', () => {
    const secret = new SecretString('my-secret-key')
    expect(secret.getValue()).toBe('my-secret-key')
  })

  it('should check if has value', () => {
    const empty = new SecretString('')
    const withValue = new SecretString('key')

    expect(empty.hasValue()).toBe(false)
    expect(withValue.hasValue()).toBe(true)
  })

  it('should mask value in toString', () => {
    expect(new SecretString('').toString()).toBe('')
    expect(new SecretString('a').toString()).toBe('*')
    expect(new SecretString('ab').toString()).toBe('**')
    expect(new SecretString('abcd').toString()).toBe('a**d')
    expect(new SecretString('abcdef').toString()).toBe('a****f')
    expect(new SecretString('abcdefgh').toString()).toBe('a******h')
  })

  it('should create from static method', () => {
    const secret = SecretString.from('test-key')
    expect(secret.getValue()).toBe('test-key')
  })
})
