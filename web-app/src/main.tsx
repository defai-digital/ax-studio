import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import {
  hideInitialLoader,
  patchBlobDownloads,
  preventDefaultFileDrop,
  showStartupError,
} from '@/lib/bootstrap/app-startup'
import { ensureCoreBridge } from '@/lib/bootstrap/core-bridge'

import './index.css'

ensureCoreBridge({ withEvents: true })

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
    console.info('[app] bootstrap started')
    const [{ routeTree }] = await Promise.all([
      import('./routeTree.gen'),
      import('./i18n'),
    ])
    console.info('[app] router and i18n ready')
    const router = createRouter({ routeTree })
    rootElement.innerHTML = ''
    const root = ReactDOM.createRoot(rootElement)
    requestAnimationFrame(() => {
      hideInitialLoader()
    })
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
    console.info('[app] React root rendered')
  } catch (error) {
    console.error('Failed to initialize app:', error)
    showStartupError()
    hideInitialLoader()
    console.error('[app] bootstrap failed:', error)
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
