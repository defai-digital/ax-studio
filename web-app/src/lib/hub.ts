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

const sanitizeHuggingFaceRepoId = (value: string): string =>
  getCleanHuggingFaceRepoId(value)

export const normalizeHuggingFaceRepoId = (
  value?: string
): string | undefined => {
  if (!value) return undefined

  const withoutPrefix = decodeHubRouteParam(value)
    .trim()
    .replace(/^https?:\/\/(?:www\.)?huggingface\.co\//i, '')
    .replace(/^huggingface\.co\//i, '')

  const cleaned = sanitizeHuggingFaceRepoId(withoutPrefix)
  const [org, repo] = cleaned.split('/')

  if (!org || !repo) return undefined
  return `${org}/${repo}`
}

export const buildHuggingFaceRepoUrl = (repoId?: string): string => {
  const normalized = normalizeHuggingFaceRepoId(repoId)
  return normalized ? `https://huggingface.co/${normalized}` : ''
}
