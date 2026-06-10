function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Highlights matched ranges from Fuse.js (indices are [start, end] inclusive pairs).
export function highlightMatch(
  text: string,
  indices: ReadonlyArray<[number, number]>,
  highlightClassName = 'search-highlight'
): string {
  if (!text || !indices.length) return escapeHtml(text)

  const parts: { text: string; highlight: boolean }[] = []
  let cursor = 0

  for (const [start, end] of indices) {
    if (start > cursor) {
      parts.push({ text: text.slice(cursor, start), highlight: false })
    }
    parts.push({ text: text.slice(start, end + 1), highlight: true })
    cursor = end + 1
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), highlight: false })
  }

  return parts
    .map((part) => {
      const escaped = escapeHtml(part.text)
      return part.highlight ? `<span class="${highlightClassName}">${escaped}</span>` : escaped
    })
    .join('')
}
