import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import {
  hideInitialLoader,
  patchBlobDownloads,
  preventDefaultFileDrop,
  showStartupError,
} from '@/lib/bootstrap/app-startup'

import './index.css'

// Prevent files from opening when dropped
const cleanupFileDropGuards = preventDefaultFileDrop()

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
    hideInitialLoader()
  }
}

void bootstrap()

// Clean up global listeners on HMR to prevent accumulation during development
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupFileDropGuards()
    cleanupBlobPatches()
  })
}
