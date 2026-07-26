import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  RouterProvider,
  createRouter,
  createHashHistory,
} from '@tanstack/react-router'
import { Channel, invoke } from '@/lib/tauri-shim/api-core'
import {
  hideInitialLoader,
  patchBlobDownloads,
  preventDefaultFileDrop,
  showStartupError,
} from '@/lib/bootstrap/app-startup'
import { ensureCoreBridge } from '@/lib/bootstrap/core-bridge'
import { isPlatformElectron } from '@/lib/platform/utils'

import './index.css'

ensureCoreBridge({ withEvents: true })

// Dev convenience: expose the Tauri IPC primitives on `window.__ax` so dev
// console snippets (and future debugging tools) can construct typed channels
// and call commands without re-importing `tauri/api/core` from outside
// the bundle. Bundle size cost is negligible — `Channel` and `invoke` are
// already imported by the chat transport.
;(window as unknown as { __ax?: { Channel: typeof Channel; invoke: typeof invoke } }).__ax = {
  Channel,
  invoke,
}

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
    // Ensure the window has input focus — on macOS 15 with transparent
    // Tauri windows the WebKit view can start without being the first responder.
    if ('__TAURI__' in window) {
      const { getCurrentWindow } = await import('@/lib/tauri-shim/api-window')
      getCurrentWindow().setFocus().catch(() => {})
    }

    const [{ routeTree }] = await Promise.all([
      import('./routeTree.gen'),
      import('./i18n'),
    ])
    console.info('[app] router and i18n ready')
    const router = createRouter({
      routeTree,
      // Electron loads the SPA from file:// (loadFile), where the browser
      // history pathname is the bundle path and cannot represent app routes.
      // Hash history keeps routing/deep links working there (and matches the
      // `{ hash: route }` child-window loads in electron/src/main.ts). Tauri
      // serves over its custom origin and keeps the default browser history.
      ...(isPlatformElectron() ? { history: createHashHistory() } : {}),
    })
    if (isPlatformElectron()) {
      // Expose the router for the Electron smoke suite (route-pruning checks)
      // and dev-console debugging. `__ax` is initialized at module scope above.
      const win = window as unknown as {
        __ax: { router?: typeof router; axBi?: Record<string, unknown> }
      }
      win.__ax.router = router
      // Smoke/dev seam for the AX BI direct path (migration matrix §4): lets
      // the Electron smoke suite drive connect → list datasets → run flow
      // against a fake MCP fixture without a settings page.
      const [{ runAxBiAuthoringWorkflow }, datasets, direct, connectionStore] =
        await Promise.all([
          import('@/lib/ax-bi/authoring-workflow'),
          import('@/lib/ax-bi/datasets'),
          import('@/lib/ax-bi/direct-client'),
          import('@/stores/ax-bi-connection-store'),
        ])
      win.__ax.axBi = {
        connect: (token?: string) => direct.connectAxBiDirect({ token }),
        status: () => connectionStore.useAxBiConnection.getState().status,
        listDatasets: async (search?: string) =>
          datasets.listAxBiDatasets({ search }),
        runWorkflow: async (prompt: string) =>
          runAxBiAuthoringWorkflow({ prompt }),
      }
    }
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
