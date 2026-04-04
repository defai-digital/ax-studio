import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'

import './index.css'

const hideInitialLoader = () => {
  document.body.classList.add('loaded')
  const loader = document.getElementById('initial-loader')
  if (loader) {
    setTimeout(() => loader.remove(), 300)
  }
}

const showStartupError = () => {
  const root = document.getElementById('root')
  if (!root || root.childElementCount > 0) return
  root.innerHTML =
    '<div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#666;">Ax-Studio failed to initialize. Please restart the app.</div>'
}

// Mobile-specific viewport and styling setup
const setupMobileViewport = () => {
  // Check if running on mobile platform (iOS/Android via Tauri)
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
                   (typeof window.matchMedia === 'function' &&
                    window.matchMedia('(max-width: 768px)').matches)

  if (isMobile) {
    // Update viewport meta tag to disable zoom
    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (viewportMeta) {
      viewportMeta.setAttribute('content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      )
    }

    // Add mobile-specific styles for status bar
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

      /* Prevent zoom on input focus */
      input, textarea, select {
        font-size: 16px !important;
      }
    `
    document.head.appendChild(style)
  }
}

// Prevent browser from opening dropped files
const handleDragOver = (e: Event) => e.preventDefault()
const handleDrop = (e: Event) => e.preventDefault()

const preventDefaultFileDrop = () => {
  document.addEventListener('dragover', handleDragOver)
  document.addEventListener('drop', handleDrop)
}

/**
 * Tauri WebView2 (Windows) silently drops blob: anchor downloads.
 * We intercept URL.createObjectURL to store the original Blob, then
 * redirect anchor.click() downloads through showSaveFilePicker so the
 * user gets a real OS save dialog for SVG / PNG / MMD exports.
 */
const patchBlobDownloads = (): (() => void) => {
  const registry = new Map<string, Blob>()

  const origCreate = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (obj: Blob | MediaSource): string => {
    const url = origCreate(obj)
    if (obj instanceof Blob) registry.set(url, obj)
    return url
  }

  const origRevoke = URL.revokeObjectURL.bind(URL)
  URL.revokeObjectURL = (url: string): void => {
    registry.delete(url)
    origRevoke(url)
  }

  const origClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (this.download && this.href.startsWith('blob:')) {
      const blob = registry.get(this.href)
      if (blob) {
        void saveBlobNative(blob, this.download)
        return
      }
    }
    origClick.call(this)
  }

  return () => {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    HTMLAnchorElement.prototype.click = origClick
    registry.clear()
  }
}

function getDialogFilters(ext: string) {
  const map: Record<string, { name: string; extensions: string[] }> = {
    svg: { name: 'SVG Image',      extensions: ['svg'] },
    png: { name: 'PNG Image',      extensions: ['png'] },
    mmd: { name: 'Mermaid Source', extensions: ['mmd'] },
  }
  return map[ext] ? [map[ext]] : []
}

function getFilePickerTypes(ext: string): object[] {
  const map: Record<string, object> = {
    svg: { description: 'SVG Image',      accept: { 'image/svg+xml': ['.svg'] } },
    png: { description: 'PNG Image',      accept: { 'image/png':     ['.png'] } },
    mmd: { description: 'Mermaid Source', accept: { 'text/plain':    ['.mmd'] } },
  }
  return map[ext] ? [map[ext]] : []
}

async function saveBlobNative(blob: Blob, filename: string): Promise<void> {
  try {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''

    if ('__TAURI__' in window) {
      // Tauri context: use native Rust save dialog — works on both
      // macOS (WKWebView, no showSaveFilePicker) and Windows (WebView2).
      const { invoke } = await import('@tauri-apps/api/core')

      const savePath = await invoke<string | null>('save_dialog', {
        options: {
          defaultPath: filename,      // rfd uses this as the suggested filename
          filters: getDialogFilters(ext),
        },
      })
      if (!savePath) return           // user cancelled

      if (ext === 'png') {
        // PNG is binary — hex-encode and let Rust decode before writing
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const hexData = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
        await invoke('write_binary_file', { path: savePath, hexData })
      } else {
        // SVG / MMD are plain text
        const text = await blob.text()
        await invoke('write_text_file', { path: savePath, content: text })
      }

    } else if ('showSaveFilePicker' in window) {
      // Plain browser / Electron with File System Access API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: getFilePickerTypes(ext),
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()

    } else {
      // Last-resort: data URI (limited browser environments)
      await new Promise<void>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const a = document.createElement('a')
          a.href = reader.result as string
          a.download = filename
          document.body.appendChild(a)
          a.dispatchEvent(new MouseEvent('click'))
          document.body.removeChild(a)
          resolve()
        }
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
        reader.readAsDataURL(blob)
      })
    }
  } catch (e) {
    // AbortError = user cancelled the dialog — silent
    if ((e as Error)?.name !== 'AbortError') {
      console.error('[ax-studio] diagram save failed:', e)
    }
  }
}

// Initialize mobile setup
setupMobileViewport()

// Prevent files from opening when dropped
preventDefaultFileDrop()

// Fix blob: anchor downloads for Tauri WebView2
const cleanupBlobPatches = patchBlobDownloads()

// Render the app
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const bootstrap = async () => {
  try {
    const [{ routeTree }] = await Promise.all([
      import('./routeTree.gen'),
      import('./i18n'),
    ])
    const router = createRouter({ routeTree })
    if (!rootElement.innerHTML) {
      const root = ReactDOM.createRoot(rootElement)
      root.render(
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>
      )
    }
  } catch (error) {
    console.error('Failed to initialize app:', error)
    showStartupError()
  } finally {
    hideInitialLoader()
  }
}

void bootstrap()

// Clean up global listeners on HMR to prevent accumulation during development
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    document.removeEventListener('dragover', handleDragOver)
    document.removeEventListener('drop', handleDrop)
    cleanupBlobPatches()
  })
}
