import { describe, expect, it } from 'vitest'
import { highlightCode } from '../code-block-highlight'

function tokenColors(html: string): Set<string> {
  return new Set(
    Array.from(html.matchAll(/style="[^"]*color:([^;"]+)/g), (match) =>
      match[1].trim()
    )
  )
}

describe('code block Shiki integration', () => {
  it('produces colored tokens for both application themes', async () => {
    const [light, dark] = await highlightCode(
      `type Result = { value: number }
const answer: Result = { value: 42 }
console.log("answer", answer.value)`,
      'typescript'
    )

    expect(tokenColors(light).size).toBeGreaterThanOrEqual(4)
    expect(tokenColors(dark).size).toBeGreaterThanOrEqual(4)
    expect(light).not.toBe(dark)
  })
})
