export function getHuggingFaceModelUrl(modelName: string): string {
  const path = modelName
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `https://huggingface.co/${path}`
}

function encodeHuggingFacePath(path: string): string {
  // Resolve `.` / `..` so file names cannot escape `/resolve/main/`.
  const resolved: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      resolved.pop()
      continue
    }
    resolved.push(encodeURIComponent(segment))
  }
  return resolved.join('/')
}

export function getHuggingFaceApiModelUrl(cleanRepoId: string): string {
  return `https://huggingface.co/api/models/${encodeHuggingFacePath(
    cleanRepoId
  )}?blobs=true&files_metadata=true`
}

export function getCleanHuggingFaceRepoId(rawRepoId: string): string {
  return rawRepoId
    .replace(/^https?:\/\/huggingface\.co\//, '')
    .replace(/^huggingface\.co\//, '')
    .replace(/\/$/, '')
    .trim()
}

export function getHuggingFaceModelFileUrl(
  repoId: string,
  fileName: string
): string {
  return `${getHuggingFaceModelUrl(repoId)}/resolve/main/${encodeHuggingFacePath(
    fileName
  )}`
}
