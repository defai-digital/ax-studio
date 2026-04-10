/* eslint-disable @typescript-eslint/no-explicit-any */
// stores/useReleaseStore.ts
import { create } from 'zustand'

type Release = {
  tag_name: string
  prerelease: boolean
  draft: boolean
  [key: string]: any
}

type ReleaseState = {
  release: Release | null
  loading: boolean
  error: string | null
  fetchLatestRelease: (includeBeta: boolean) => Promise<void>
}

// Tracks the most recent in-flight fetch so rapid successive calls cancel
// the previous request. Without this, a slow earlier request can resolve
// after a fast later one and overwrite `release` with stale data.
let currentFetchController: AbortController | null = null

export const useReleaseNotes = create<ReleaseState>((set) => ({
  release: null,
  loading: false,
  error: null,

  fetchLatestRelease: async (includeBeta: boolean) => {
    currentFetchController?.abort()
    const controller = new AbortController()
    currentFetchController = controller

    set({ loading: true, error: null })
    try {
      const res = await fetch(
        'https://api.github.com/repos/ax-studio/ax-studio/releases',
        { signal: controller.signal }
      )
      if (!res.ok) throw new Error('Failed to fetch releases')
      const releases = await res.json()
      if (controller.signal.aborted) return

      const stableRelease = releases.find(
        (release: { prerelease: boolean; draft: boolean }) =>
          !release.prerelease && !release.draft
      )
      const betaRelease = releases.find(
        (release: { prerelease: boolean }) => release.prerelease
      )

      const selected = includeBeta
        ? (betaRelease ?? stableRelease)
        : stableRelease
      set({ release: selected, loading: false })
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return
      set({ error: err.message, loading: false })
    } finally {
      if (currentFetchController === controller) {
        currentFetchController = null
      }
    }
  },
}))
