import { describe, it, expect } from 'vitest'
import { sanitizeMermaidFences } from '../RenderMarkdown'

describe('sanitizeMermaidFences', () => {
  const wrap = (body: string) => `\`\`\`mermaid\n${body}\n\`\`\``

  describe('Fix 3: quote [] labels with unsafe characters', () => {
    it('quotes labels containing spaces', () => {
      const input = wrap(`classDiagram
class PORT[Serial Port] {
  +int baudRate
}`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('PORT["Serial Port"]')
    })

    it('quotes labels containing apostrophes', () => {
      const input = wrap(`flowchart TD
    A[Recipient's Device] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Recipient\'s Device"]')
    })

    it('quotes labels containing parentheses', () => {
      const input = wrap(`flowchart TD
    A[Setup (X3DH)] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Setup (X3DH)"]')
    })

    it('does not quote already-quoted labels', () => {
      const input = wrap(`flowchart TD
    A["Already Quoted"] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Already Quoted"]')
      expect(result).not.toContain('[""Already Quoted""]')
    })

    it('does not quote simple single-word labels', () => {
      const input = wrap(`flowchart TD
    A[Hello] --> B[World]`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A[Hello]')
      expect(result).toContain('B[World]')
    })

    it('quotes labels with angle brackets', () => {
      const input = wrap(`flowchart TD
    A[foo<bar>] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["foo<bar>"]')
    })

    it('quotes labels with pipe character', () => {
      const input = wrap(`flowchart TD
    A[foo|bar] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["foo|bar"]')
    })

    it('handles multiple labels on the same line', () => {
      const input = wrap(`flowchart TD
    A[Hello World] --> B[Goodbye Moon]`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Hello World"]')
      expect(result).toContain('B["Goodbye Moon"]')
    })

    it('handles classDiagram class labels with spaces', () => {
      const input = wrap(`classDiagram
class UART["Serial Port"] {
  +int baudRate
}
class PORT[Serial Port] {
  +int baudRate
}`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('UART["Serial Port"]')
      expect(result).toContain('PORT["Serial Port"]')
    })
  })

  describe('Fix 1b: strip invalid title comments', () => {
    it('strips quoted title after diagram type', () => {
      const input = wrap(`erDiagram """My Title"""
    EMPLOYEE ||--|| DEPARTMENT : works_in`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('erDiagram')
      expect(result).not.toContain('"""My Title"""')
      expect(result).toContain('EMPLOYEE ||--|| DEPARTMENT')
    })
  })

  describe('Fix 2: bare flowchart gets TD direction', () => {
    it('adds TD to bare flowchart', () => {
      const input = wrap(`flowchart
    A --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('flowchart TD')
    })
  })

  describe('Fix 4: close unclosed class bodies', () => {
    it('appends missing closing braces for classDiagram', () => {
      const input = wrap(`classDiagram
class Foo {
  +int x`)
      const result = sanitizeMermaidFences(input)
      const body = result.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? ''
      const opens = (body.match(/\{/g) ?? []).length
      const closes = (body.match(/\}/g) ?? []).length
      expect(opens).toBe(closes)
    })
  })

  describe('Fix 10: collapse consecutive blank lines', () => {
    it('collapses 3+ consecutive newlines to 2', () => {
      const input = wrap(`flowchart TD
    A --> B



    B --> C`)
      const result = sanitizeMermaidFences(input)
      expect(result).not.toMatch(/\n{3,}/)
    })
  })

  describe('Fix 1b normalization: fence and type on same line', () => {
    it('splits ```mermaid classDiagram to separate lines', () => {
      const input = '```mermaid classDiagram\n\nclass Foo\n```'
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('```mermaid\nclassDiagram')
    })
  })
})
