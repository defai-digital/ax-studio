export function getHuggingFaceModelUrl(modelName: string): string {
  const path = modelName
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `https://huggingface.co/${path}`
}

export function getHuggingFaceApiModelUrl(cleanRepoId: string): string {
  return `https://huggingface.co/api/models/${encodeURIComponent(
    cleanRepoId
  )}?blobs=true&files_metadata=true`
}

export function getHuggingFaceModelFileUrl(
  repoId: string,
  fileName: string
): string {
  return `${getHuggingFaceModelUrl(repoId)}/resolve/main/${encodeURIComponent(
    fileName
  )}`
}
