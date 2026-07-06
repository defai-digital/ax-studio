interface PlainDecimalOptions {
  allowTrailingDot?: boolean
}

function isAsciiDigit(value: string, index: number): boolean {
  const code = value.charCodeAt(index)
  return code >= 48 && code <= 57
}

export function isPlainDecimalString(
  value: string,
  options: PlainDecimalOptions = {}
): boolean {
  let index = 0
  if (value[index] === '+' || value[index] === '-') index += 1

  let wholeDigits = 0
  while (index < value.length && isAsciiDigit(value, index)) {
    wholeDigits += 1
    index += 1
  }

  let fractionalDigits = 0
  let hasDecimalPoint = false
  if (value[index] === '.') {
    hasDecimalPoint = true
    index += 1
    while (index < value.length && isAsciiDigit(value, index)) {
      fractionalDigits += 1
      index += 1
    }
  }

  if (index !== value.length) return false
  if (wholeDigits + fractionalDigits === 0) return false
  if (hasDecimalPoint && fractionalDigits === 0) {
    return options.allowTrailingDot === true && wholeDigits > 0
  }

  return true
}

export function parsePlainDecimalNumber(
  value: unknown,
  options: PlainDecimalOptions = {}
): number | null {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '')
  const trimmed = raw.trim()
  if (trimmed === '' || !isPlainDecimalString(trimmed, options)) return null

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}
