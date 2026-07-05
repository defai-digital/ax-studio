import { useCallback, useRef, useState } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'

export type ModelSupportStatus = 'RED' | 'YELLOW' | 'GREEN' | 'GREY' | 'LOADING'

type ModelSupportVariant = {
  model_id: string
  path: string
}

export function useModelSupportStatus() {
  const serviceHub = useServiceHub()
  const [modelSupportStatus, setModelSupportStatus] = useState<
    Record<string, ModelSupportStatus>
  >({})
  const inFlightModelChecks = useRef(new Set<string>())
  const modelSupportStatusRef = useRef(modelSupportStatus)
  modelSupportStatusRef.current = modelSupportStatus

  const checkModelSupport = useCallback(
    async (variant: ModelSupportVariant) => {
      const modelKey = variant.model_id

      if (
        inFlightModelChecks.current.has(modelKey) ||
        modelSupportStatusRef.current[modelKey]
      ) {
        return
      }

      inFlightModelChecks.current.add(modelKey)
      setModelSupportStatus((prev) => ({
        ...prev,
        [modelKey]: 'LOADING',
      }))

      try {
        const supportStatus = await serviceHub
          .models()
          .isModelSupported(variant.path, 8192)

        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: supportStatus,
        }))
      } catch (error) {
        console.error('Error checking model support:', error)
        setModelSupportStatus((prev) => ({
          ...prev,
          [modelKey]: 'RED',
        }))
      } finally {
        inFlightModelChecks.current.delete(modelKey)
      }
    },
    [serviceHub]
  )

  return {
    modelSupportStatus,
    checkModelSupport,
  }
}
