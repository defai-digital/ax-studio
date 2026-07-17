const sanitizePersistedStorage = () => {
  const jsonStorageKeys = [
    'left-panel',
    'threads',
    'messages',
    'theme',
    'model-provider',
    'model-sources',
    'setting-appearance',
    'setting-general',
    'setting-local-api-server',
    'setting-proxy-config',
    'setting-hardware',
    'tool-approval',
    'tool-availability',
    'favorite-models',
    'thread-management',
    'ax-studio-service-config',
  ]

  for (const key of jsonStorageKeys) {
    const value = localStorage.getItem(key)
    if (!value) continue
    try {
      JSON.parse(value)
    } catch {
      localStorage.removeItem(key)
    }
  }
}

const hideInitialLoader = () => {
  const loader = document.getElementById('initial-loader')
  if (!loader) return
  document.body.classList.add('loaded')
  setTimeout(() => loader.remove(), 300)
}

const showStartupError = () => {
  const root = document.getElementById('root')
  if (!root) return

  const message = document.createElement('div')
  Object.assign(message.style, {
    alignItems: 'center',
    color: '#666',
    display: 'flex',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    height: '100vh',
    justifyContent: 'center',
    padding: '16px',
    textAlign: 'center',
  })
  message.textContent = 'AX Studio failed to initialize. Please restart the app.'
  root.replaceChildren(message)
}

const startupFailSafe = () => {
  if (!document.getElementById('initial-loader')) return
  hideInitialLoader()
  showStartupError()
}

const startupFallback = setTimeout(() => {
  const root = document.getElementById('root')
  if (!root || root.childElementCount === 0) {
    startupFailSafe()
  }
}, 30000)

sanitizePersistedStorage()
window.addEventListener('error', startupFailSafe, { once: true })
window.addEventListener('unhandledrejection', startupFailSafe, { once: true })
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('load', () => clearTimeout(startupFallback), {
    once: true,
  })
})
