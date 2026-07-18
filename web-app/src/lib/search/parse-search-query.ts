/**
 * Parsing for the global search query syntax.
 *
 * Supported filter prefixes (Slack/GitHub convention):
 * - `folder:<name>` / `folder:"my folder"` — threads in a chat folder
 * - `tag:<name>` / `tag:"my tag"` — threads carrying a tag
 * - `is:pinned` — pinned threads only
 *
 * Anything else (including unknown prefixes and known prefixes with an empty
 * or unsupported value) is treated as free text. Pure functions only — folder
 * and tag names are resolved case-insensitively against a caller-supplied
 * snapshot of the chat-organization store, keeping this module store-agnostic
 * and trivially testable.
 */

export type ParsedSearchQuery = {
  /** Remaining free text with filter tokens removed, single-space joined. */
  freeText: string
  /** Raw (unresolved) folder name from `folder:<name>`, if present. */
  folderName?: string
  /** Raw (unresolved) tag name from `tag:<name>`, if present. */
  tagName?: string
  /** True when the query contains `is:pinned`. */
  pinnedOnly: boolean
}

export type SearchFilterOrganization = {
  folders: ReadonlyArray<{ id: string; name: string }>
  tags: ReadonlyArray<{ id: string; name: string }>
}

export type ResolvedSearchFilters = {
  freeText: string
  pinnedOnly: boolean
  /**
   * Present when a `folder:` filter was given. `null` when the name matched
   * no known folder — an unmatched filter matches no threads.
   */
  folderId?: string | null
  /** Same semantics as `folderId`, for `tag:`. */
  tagId?: string | null
}

const FILTER_TOKEN_PATTERN = /^([a-z]+):(.+)$/i

/**
 * Split on whitespace, but keep double-quoted spans together so that
 * `folder:"my folder"` arrives as a single `folder:my folder` token.
 * Quote characters are consumed wherever they appear.
 */
const tokenize = (input: string): string[] => {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false
  let tokenStarted = false

  const flush = () => {
    if (tokenStarted) tokens.push(current)
    current = ''
    tokenStarted = false
  }

  for (const ch of input) {
    if (ch === '"') {
      inQuotes = !inQuotes
      tokenStarted = true
    } else if (!inQuotes && /\s/.test(ch)) {
      flush()
    } else {
      current += ch
      tokenStarted = true
    }
  }
  flush()

  return tokens
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const freeTextTokens: string[] = []
  let folderName: string | undefined
  let tagName: string | undefined
  let pinnedOnly = false

  for (const token of tokenize(input)) {
    const match = FILTER_TOKEN_PATTERN.exec(token)
    if (match) {
      const prefix = match[1].toLowerCase()
      const value = match[2]
      // A repeated prefix overrides the earlier one (single folder/tag filter).
      if (prefix === 'folder') {
        folderName = value
        continue
      }
      if (prefix === 'tag') {
        tagName = value
        continue
      }
      if (prefix === 'is' && value.toLowerCase() === 'pinned') {
        pinnedOnly = true
        continue
      }
    }
    // Unknown prefixes, empty values (`folder:`), and unsupported `is:` values
    // all fall through to free text.
    freeTextTokens.push(token)
  }

  return {
    freeText: freeTextTokens.join(' ').trim(),
    folderName,
    tagName,
    pinnedOnly,
  }
}

export function resolveSearchFilters(
  parsed: ParsedSearchQuery,
  organization: SearchFilterOrganization
): ResolvedSearchFilters {
  const folderId =
    parsed.folderName === undefined
      ? undefined
      : (organization.folders.find(
          (folder) =>
            folder.name.toLowerCase() === parsed.folderName?.toLowerCase()
        )?.id ?? null)

  const tagId =
    parsed.tagName === undefined
      ? undefined
      : (organization.tags.find(
          (tag) => tag.name.toLowerCase() === parsed.tagName?.toLowerCase()
        )?.id ?? null)

  return {
    freeText: parsed.freeText,
    pinnedOnly: parsed.pinnedOnly,
    folderId,
    tagId,
  }
}
