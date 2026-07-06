import { getCleanHuggingFaceRepoId } from './huggingface'
import type { ModelQuant } from '@/services/models/types'

const MODEL_SIZE_TAG_PATTERN =
  /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?:$|[^a-z0-9])/i

function formatModelSizeTag(value: number): string {
  return `${value}b`
}

export function extractModelSizeTags(
  quants: Array<Pick<ModelQuant, 'model_id'>> | undefined
): string[] {
  if (!quants) return []

  const tags = new Map<string, number>()
  for (const quant of quants) {
    const match = quant.model_id.match(MODEL_SIZE_TAG_PATTERN)
    if (!match) continue

    const value = Number(match[1])
    if (!Number.isFinite(value) || value <= 0) continue

    const label = formatModelSizeTag(value)
    tags.set(label, value)
  }

  return Array.from(tags.entries())
    .sort(([labelA, valueA], [labelB, valueB]) => {
      if (valueA !== valueB) return valueA - valueB
      return labelA.localeCompare(labelB)
    })
    .map(([label]) => label)
}

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
