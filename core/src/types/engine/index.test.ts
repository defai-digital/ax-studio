import { describe, it, expect } from 'vitest'
import { SecretString, validateTemplate, createValidatedTemplate, ValidatedTemplate } from './index'

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

describe('validateTemplate', () => {
  it('should allow empty templates', () => {
    expect(validateTemplate('')).toBe(true)
    expect(validateTemplate('   ')).toBe(true)
  })

  it('should allow safe template patterns', () => {
    expect(validateTemplate('{{variable}}')).toBe(true)
    expect(validateTemplate('${variable}')).toBe(true)
    expect(validateTemplate('%variable%')).toBe(true)
    expect(validateTemplate('{variable}')).toBe(true)
    expect(validateTemplate('{{object.property}}')).toBe(true)
  })

  it('should reject dangerous patterns', () => {
    expect(validateTemplate('<script>alert(1)</script>')).toBe(false)
    expect(validateTemplate('javascript:alert(1)')).toBe(false)
    expect(validateTemplate('onclick=alert(1)')).toBe(false)
    expect(validateTemplate('eval(console.log(1))')).toBe(false)
    expect(validateTemplate('new Function("code")')).toBe(false)
    expect(validateTemplate('require("fs")')).toBe(false)
    expect(validateTemplate('import("module")')).toBe(false)
  })

  it('should reject code-like structures', () => {
    expect(validateTemplate('function test() { return 1; }')).toBe(false)
    expect(validateTemplate('const x = 1; let y = 2;')).toBe(false)
    expect(validateTemplate('class MyClass {}')).toBe(false)
  })

  it('should reject excessive structural characters', () => {
    expect(validateTemplate('{{{variable}}}')).toBe(false) // too many braces
    expect(validateTemplate('a;b;c;d;')).toBe(false) // too many semicolons
  })

  it('should allow templates with safe patterns mixed with text', () => {
    expect(validateTemplate('Hello {{name}}, welcome!')).toBe(true)
    expect(validateTemplate('Data: ${value} and %other%')).toBe(true)
    expect(validateTemplate('Select from {table};')).toBe(true)
  })

  it('should reject malformed placeholder syntax', () => {
    expect(validateTemplate('{{ user.name + 1 }}')).toBe(false)
    expect(validateTemplate('${user.name ?? fallback}')).toBe(false)
  })
})

describe('createValidatedTemplate', () => {
  it('should create validated template for safe input', () => {
    const template = createValidatedTemplate('{{variable}}')
    expect(typeof template).toBe('string')
    expect(template).toBe('{{variable}}')
  })

  it('should throw error for unsafe input', () => {
    expect(() => createValidatedTemplate('<script>alert(1)</script>')).toThrow('Template contains potentially unsafe patterns')
  })

  it('should allow empty templates', () => {
    const template = createValidatedTemplate('')
    expect(template).toBe('')
  })
})

describe('ValidatedTemplate type safety', () => {
  it('should ensure type safety for validated templates', () => {
    // This should compile and work
    const safeTemplate: ValidatedTemplate = createValidatedTemplate('{{safe}}')

    // This would not compile if we tried to assign plain string
    // const unsafe: ValidatedTemplate = '<script>' // Type error

    expect(safeTemplate).toBe('{{safe}}')
  })
})
