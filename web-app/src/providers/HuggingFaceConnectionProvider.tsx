import { useEffect } from 'react'
import { useHuggingFaceConnection } from '@/hooks/models/useHuggingFaceConnection'

export function HuggingFaceConnectionProvider() {
  const initialize = useHuggingFaceConnection((state) => state.initialize)

  useEffect(() => {
    void initialize()
  }, [initialize])

  return null
}
