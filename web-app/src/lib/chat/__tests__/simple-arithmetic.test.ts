import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { simpleArithmeticAnswer } from '../simple-arithmetic'
const message = (text: string): UIMessage[] => [
  { id: 'user', role: 'user', parts: [{ type: 'text', text }] },
]
describe('bare arithmetic answers (#840)', () => {
  it.each([
    ['2+2', '4'],
    ['9 + 8', '17'],
    ['9 - 8', '1'],
    ['14- 7 =', '7'],
    ['0.1+0.2', '0.3'],
    ['-2*-3', '6'],
    ['3÷4', '0.75'],
    ['9007199254740993+1', '9007199254740994'],
  ])('answers %s exactly', (input, expected) => {
    expect(simpleArithmeticAnswer(message(input))).toBe(expected)
  })
  it.each([
    'Write Python for 2+2',
    'explain 2+2',
    '1/0',
    '1/3',
    'alert(1)',
    '2026-09-14',
    '1e300*2',
    '2**3',
    '',
  ])('leaves %s to the normal chat path', (input) => {
    expect(simpleArithmeticAnswer(message(input))).toBeUndefined()
  })
  it('does not use stale history or bypass attachments', () => {
    expect(
      simpleArithmeticAnswer([
        ...message('2+2'),
        {
          id: 'assistant',
          role: 'assistant',
          parts: [{ type: 'text', text: '4' }],
        },
      ])
    ).toBeUndefined()
    const messages = message('2+2')
    messages[0].parts.push({
      type: 'file',
      mediaType: 'text/plain',
      url: 'https://example.com/file',
    })
    expect(simpleArithmeticAnswer(messages)).toBeUndefined()
  })
})
