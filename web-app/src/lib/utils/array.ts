export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function appendUniqueString(values: string[], value: string): string[] {
  if (values.includes(value)) return values
  return [...values, value]
}
