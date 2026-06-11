import { create } from 'zustand'

export interface DownloadProgressProps {
  id: string
  progress: number
  name: string
  current: number
  total: number
}

export const toDownloadProcesses = (
  downloads: Record<string, DownloadProgressProps>,
  localDownloadingModels?: Set<string>
): DownloadProgressProps[] => {
  const downloadsWithProgress = Object.values(downloads).map((download) => ({
    id: download.name,
    name: download.name,
    progress: download.progress,
    current: download.current,
    total: download.total,
  }))

  if (!localDownloadingModels) return downloadsWithProgress

  const localDownloadsWithoutProgress = Array.from(localDownloadingModels)
    .filter((modelId) => !downloads[modelId])
    .map((modelId) => ({
      id: modelId,
      name: modelId,
      progress: 0,
      current: 0,
      total: 0,
    }))

  return [...downloadsWithProgress, ...localDownloadsWithoutProgress]
}

// Zustand store for thinking block state
export type DownloadState = {
  downloads: { [id: string]: DownloadProgressProps }
  localDownloadingModels: Set<string>
  removeDownload: (id: string) => void
  updateProgress: (
    id: string,
    progress: number,
    name?: string,
    current?: number,
    total?: number
  ) => void
  addLocalDownloadingModel: (modelId: string) => void
  removeLocalDownloadingModel: (modelId: string) => void
}

/**
 * This store is used to manage the download progress of files.
 */
export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: {},
  localDownloadingModels: new Set(),
  removeDownload: (id: string) =>
    set((state) => {
       
      const { [id]: _, ...rest } = state.downloads
      return { downloads: rest }
    }),

  updateProgress: (id, progress, name, current, total) =>
    set((state) => ({
      downloads: {
        ...state.downloads,
        [id]: {
          ...state.downloads[id],
          name: name ?? state.downloads[id]?.name ?? '',
          progress,
          current: current ?? state.downloads[id]?.current ?? 0,
          total: total ?? state.downloads[id]?.total ?? 0,
        },
      },
    })),

  addLocalDownloadingModel: (modelId: string) =>
    set((state) => ({
      localDownloadingModels: new Set(state.localDownloadingModels).add(
        modelId
      ),
    })),

  removeLocalDownloadingModel: (modelId: string) =>
    set((state) => {
      const newSet = new Set(state.localDownloadingModels)
      newSet.delete(modelId)
      return { localDownloadingModels: newSet }
    }),
}))
