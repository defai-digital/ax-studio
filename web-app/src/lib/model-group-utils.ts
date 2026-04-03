/**
 * Utilities for grouping model IDs by their upstream prefix.
 *
 * Multi-upstream gateways (e.g. Cloudflare AI Gateway) return model IDs
 * that encode the upstream provider as the first path segment:
 *   "workers-ai/@cf/qwen/model"  → prefix "workers-ai"
 *   "openrouter/qwen/model"      → prefix "openrouter"
 *   "gpt-4o"                     → prefix "" (no slash)
 */

export type ModelGroup = {
  /** Raw prefix string (e.g. "workers-ai", "openrouter", "" for no prefix) */
  prefix: string
  /** Human-readable name for display (e.g. "Workers AI", "Other") */
  displayName: string
  /** Model IDs belonging to this group */
  modelIds: string[]
}

/**
 * Format a raw prefix into a human-readable name.
 * "workers-ai" → "Workers AI", "google-vertex-ai" → "Google Vertex AI"
 */
export function formatPrefixName(prefix: string): string {
  if (!prefix) return 'Other'
  return prefix
    .split('-')
    .map((word) => {
      // Keep known abbreviations uppercase
      if (['ai', 'api', 'ml'].includes(word.toLowerCase())) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * Group model IDs by their first path segment (prefix).
 * Returns an array of ModelGroup objects sorted by group size (largest first).
 */
export function groupModelsByPrefix(modelIds: string[]): ModelGroup[] {
  const groupMap = new Map<string, string[]>()

  for (const id of modelIds) {
    const slashIdx = id.indexOf('/')
    const prefix = slashIdx > 0 ? id.substring(0, slashIdx) : ''
    const group = groupMap.get(prefix) ?? []
    group.push(id)
    groupMap.set(prefix, group)
  }

  return Array.from(groupMap.entries())
    .map(([prefix, ids]) => ({
      prefix,
      displayName: formatPrefixName(prefix),
      modelIds: ids,
    }))
    .sort((a, b) => b.modelIds.length - a.modelIds.length)
}
