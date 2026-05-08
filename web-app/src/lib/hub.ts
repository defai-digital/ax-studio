import { getCleanHuggingFaceRepoId } from './huggingface'

export const decodeHubRouteParam = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const encodeHubRouteParam = (value: string): string => {
  return encodeURIComponent(value)
}

const huggingFaceRepoIdRegex = /huggingface\.co\/([^/?#]+\/[^/?#]+)/i

const sanitizeHuggingFaceRepoId = (value: string): string =>
  getCleanHuggingFaceRepoId(value)

export const normalizeHuggingFaceRepoId = (
  value?: string
): string | undefined => {
  if (!value) return undefined

  const decoded = decodeHubRouteParam(value)
  const trimmed = sanitizeHuggingFaceRepoId(decoded)
  if (!trimmed) return undefined

  const matched = trimmed.match(huggingFaceRepoIdRegex)
  if (matched?.[1]) {
    return sanitizeHuggingFaceRepoId(decodeHubRouteParam(matched[1] ?? ''))
  }

  const withoutPrefix = getCleanHuggingFaceRepoId(
    trimmed
      .replace(/^https?:\/\/huggingface\.co\//i, '')
      .replace(/^huggingface\.co\//i, '')
  )

  if (!withoutPrefix.includes('/')) return undefined
  return withoutPrefix
}

export const buildHuggingFaceRepoUrl = (repoId?: string): string => {
  const normalized = normalizeHuggingFaceRepoId(repoId)
  return normalized ? `https://huggingface.co/${normalized}` : ''
}
