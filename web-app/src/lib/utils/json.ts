export const safeJSONParse = <T>(
  raw: string | null | undefined
): T | null => {
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
