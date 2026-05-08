export const downloadBlob = (blob: Blob, filename: string): void => {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(objectUrl)
}

export const downloadTextAsFile = (
  content: string,
  filename: string,
  mimeType: string
): void => {
  downloadBlob(new Blob([content], { type: mimeType }), filename)
}

