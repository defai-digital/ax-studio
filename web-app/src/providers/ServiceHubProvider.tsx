import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { useAxStudioConfig } from '@/stores/useAxStudioConfig'

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    // Sync persisted service URLs to the Rust backend so the proxy server
    // can forward /retrieval/*, /agents/*, /vectors/* to the correct services.
    useAxStudioConfig.getState().syncToBackend().catch(() => {
      // Non-fatal: may not be in Tauri context
    })

    initializeServiceHub()
      .then((hub) => {
        console.log('Services initialized, initializing Zustand store')
        initializeServiceHubStore(hub)
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Service initialization failed:', error)
        setIsReady(true) // Still render to show error state
      })
  }, [])

  return <>{isReady && children}</>
}
