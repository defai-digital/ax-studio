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
    '<div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#666;">Ax-Fabric failed to initialize. Please restart the app.</div>'
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
const preventDefaultFileDrop = () => {
  document.addEventListener('dragover', (e) => {
    e.preventDefault()
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
  })
}

// Initialize mobile setup
setupMobileViewport()

// Prevent files from opening when dropped
preventDefaultFileDrop()

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
