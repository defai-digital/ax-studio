import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage/storage'

const LIMIT = 20
const MAX_QUERY_LENGTH = 500

export function useSearchHistory(
  scope: string,
  value: string,
  onChange: (value: string) => void
) {
  const key = `search-query-history:${scope}`
  const navigation = useRef<{
    queries: string[]
    index: number
    draft: string
  } | null>(null)
  useEffect(() => {
    const state = navigation.current
    if (
      state &&
      value !== (state.index < 0 ? state.draft : state.queries[state.index])
    )
      navigation.current = null
  }, [value])
  useEffect(() => {
    navigation.current = null
  }, [key])
  const read = useCallback((): string[] => {
    try {
      const parsed: unknown = JSON.parse(
        safeStorageGetItem(localStorage, key, 'search history') ?? '[]'
      )
      if (!Array.isArray(parsed)) return []
      return [
        ...new Set(
          parsed.filter(
            (item): item is string =>
              typeof item === 'string' &&
              !!item.trim() &&
              item.length <= MAX_QUERY_LENGTH
          )
        ),
      ].slice(0, LIMIT)
    } catch {
      return []
    }
  }, [key])
  const remember = useCallback(() => {
    const query = value.trim()
    if (!query || query.length > MAX_QUERY_LENGTH) return
    safeStorageSetItem(
      localStorage,
      key,
      JSON.stringify(
        [query, ...read().filter((item) => item !== query)].slice(0, LIMIT)
      ),
      'search history'
    )
  }, [key, read, value])
  const change = (next: string) => {
    navigation.current = null
    onChange(next)
  }
  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    allowStart = true
  ): boolean => {
    if (
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return false
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    if (!navigation.current) {
      if (event.key !== 'ArrowUp' || (!allowStart && !event.altKey))
        return false
      const queries = read()
      if (!queries.length) return false
      navigation.current = { queries, index: -1, draft: value }
    }
    event.preventDefault()
    event.stopPropagation()
    const state = navigation.current
    state.index =
      event.key === 'ArrowUp'
        ? Math.min(state.index + 1, state.queries.length - 1)
        : Math.max(state.index - 1, -1)
    onChange(state.index < 0 ? state.draft : state.queries[state.index])
    if (state.index < 0) navigation.current = null
    return true
  }
  return { change, remember, onKeyDown }
}
