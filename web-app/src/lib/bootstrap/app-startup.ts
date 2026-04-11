type FilePickerAcceptType = {
  description: string
  accept: Record<string, string[]>
}

type SaveFilePickerOptions = {
  suggestedName: string
  types: FilePickerAcceptType[]
}

type WritableFileHandle = {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

type SaveFileHandle = {
  createWritable: () => Promise<WritableFileHandle>
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<SaveFileHandle>
}

const LOADER_REMOVE_DELAY_MS = 300

export function hideInitialLoader() {
  document.body.classList.add('loaded')
  const loader = document.getElementById('initial-loader')
  if (loader) {
    setTimeout(() => loader.remove(), LOADER_REMOVE_DELAY_MS)
  }
}

export function showStartupError() {
  const root = document.getElementById('root')
  if (!root || root.childElementCount > 0) return

  root.innerHTML =
    '<div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#666;">Ax-Studio failed to initialize. Please restart the app.</div>'
}

export function setupMobileViewport() {
  const isMobile =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 768px)').matches)

  if (!isMobile) return

  const viewportMeta = document.querySelector('meta[name="viewport"]')
  if (viewportMeta) {
    viewportMeta.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
    )
  }

  const style = document.createElement('style')
  style.textContent = `
    body {
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    }

    #root {
      min-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    }

    input, textarea, select {
      font-size: 16px !important;
    }
  `
  document.head.appendChild(style)
}

export function preventDefaultFileDrop(): () => void {
  const handleDragOver = (event: Event) => event.preventDefault()
  const handleDrop = (event: Event) => event.preventDefault()

  document.addEventListener('dragover', handleDragOver)
  document.addEventListener('drop', handleDrop)

  return () => {
    document.removeEventListener('dragover', handleDragOver)
    document.removeEventListener('drop', handleDrop)
  }
}

export function patchBlobDownloads(): () => void {
  const registry = new Map<string, Blob>()

  const originalCreateObjectUrl = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (obj: Blob | MediaSource): string => {
    const url = originalCreateObjectUrl(obj)
    if (obj instanceof Blob) registry.set(url, obj)
    return url
  }

  const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL)
  URL.revokeObjectURL = (url: string): void => {
    registry.delete(url)
    originalRevokeObjectUrl(url)
  }

  const originalAnchorClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download && this.href.startsWith('blob:')) {
      const blob = registry.get(this.href)
      if (blob) {
        void saveBlobNative(blob, this.download)
        return
      }
    }

    originalAnchorClick.call(this)
  }

  return () => {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
    HTMLAnchorElement.prototype.click = originalAnchorClick
    registry.clear()
  }
}

function getDialogFilters(ext: string) {
  const map: Record<string, { name: string; extensions: string[] }> = {
    svg: { name: 'SVG Image', extensions: ['svg'] },
    png: { name: 'PNG Image', extensions: ['png'] },
    mmd: { name: 'Mermaid Source', extensions: ['mmd'] },
  }

  return map[ext] ? [map[ext]] : []
}

function getFilePickerTypes(ext: string): FilePickerAcceptType[] {
  const map: Record<string, FilePickerAcceptType> = {
    svg: {
      description: 'SVG Image',
      accept: { 'image/svg+xml': ['.svg'] },
    },
    png: {
      description: 'PNG Image',
      accept: { 'image/png': ['.png'] },
    },
    mmd: {
      description: 'Mermaid Source',
      accept: { 'text/plain': ['.mmd'] },
    },
  }

  return map[ext] ? [map[ext]] : []
}

async function saveBlobNative(blob: Blob, filename: string): Promise<void> {
  try {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if ('__TAURI__' in window) {
      const { invoke } = await import('@tauri-apps/api/core')

      const savePath = await invoke<string | null>('save_dialog', {
        options: {
          defaultPath: filename,
          filters: getDialogFilters(ext),
        },
      })

      if (!savePath) return

      if (ext === 'png') {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const hexData = Array.from(bytes, (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
        await invoke('write_binary_file', { path: savePath, hexData })
      } else {
        const text = await blob.text()
        await invoke('write_text_file', { path: savePath, content: text })
      }

      return
    }

    const pickerWindow = window as SaveFilePickerWindow
    if (pickerWindow.showSaveFilePicker) {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: getFilePickerTypes(ext),
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    }

    await new Promise<void>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const anchor = document.createElement('a')
        anchor.href = reader.result as string
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.dispatchEvent(new MouseEvent('click'))
        document.body.removeChild(anchor)
        resolve()
      }
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      console.error('[ax-studio] diagram save failed:', error)
    }
  }
}
