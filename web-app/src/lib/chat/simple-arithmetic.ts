import type { UIMessage } from 'ai'

// A deliberately narrow calculator: two decimal operands, no evaluation of
// code, natural-language instructions, attachments, or expressions from history.
export function simpleArithmeticAnswer(
  messages: UIMessage[]
): string | undefined {
  const last = messages.at(-1)
  if (
    last?.role !== 'user' ||
    last.parts.length !== 1 ||
    last.parts[0].type !== 'text'
  )
    return
  const text = last.parts[0].text
  if (text.length > 100) return
  const match = text
    .trim()
    .match(
      /^([+-]?\d{1,20}(?:\.\d{1,12})?)\s*([+\-*/×÷])\s*([+-]?\d{1,20}(?:\.\d{1,12})?)\s*=?$/
    )
  if (!match) return
  const decimal = (value: string): [bigint, bigint] => {
    const places = value.split('.')[1]?.length ?? 0
    return [BigInt(value.replace('.', '')), 10n ** BigInt(places)]
  }
  const [a, ad] = decimal(match[1])
  const [b, bd] = decimal(match[3])
  let numerator: bigint, denominator: bigint
  switch (match[2]) {
    case '+':
      numerator = a * bd + b * ad
      denominator = ad * bd
      break
    case '-':
      numerator = a * bd - b * ad
      denominator = ad * bd
      break
    case '*':
    case '×':
      numerator = a * b
      denominator = ad * bd
      break
    default:
      if (b === 0n) return
      numerator = a * bd
      denominator = ad * b
  }
  const negative = numerator < 0n !== denominator < 0n
  numerator = numerator < 0n ? -numerator : numerator
  denominator = denominator < 0n ? -denominator : denominator
  const integer = numerator / denominator
  let remainder = numerator % denominator
  let fraction = ''
  // Only return exact terminating decimals. Recurring/long division continues
  // through the normal model path instead of silently rounding an answer.
  while (remainder && fraction.length < 24) {
    remainder *= 10n
    fraction += String(remainder / denominator)
    remainder %= denominator
  }
  if (remainder) return
  return `${negative && numerator ? '-' : ''}${integer}${fraction ? '.' + fraction : ''}`
}
