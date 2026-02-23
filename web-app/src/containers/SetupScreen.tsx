/**
 * Ax-Fabric Setup / Onboarding Screen
 *
 * Shown on first launch.  Replaces the original local-model download flow with
 * an Ax-Fabric backend service configuration step so the user can point the
 * app at their self-hosted services before entering the main UI.
 */

import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useAxFabricConfig } from '@/stores/useAxFabricConfig'
import HeaderPage from './HeaderPage'

interface SetupScreenProps {
  onComplete?: () => void
}

function SetupScreen({ onComplete }: SetupScreenProps) {
  const { t } = useTranslation()
  const { config, setConfig } = useAxFabricConfig()

  const [apiServiceUrl, setApiServiceUrl] = useState(config.apiServiceUrl)
  const [retrievalServiceUrl, setRetrievalServiceUrl] = useState(
    config.retrievalServiceUrl
  )
  const [agentsServiceUrl, setAgentsServiceUrl] = useState(
    config.agentsServiceUrl
  )
  const [akidbUrl, setAkidbUrl] = useState(config.akidbUrl)
  const [isSaving, setIsSaving] = useState(false)

  const handleGetStarted = async () => {
    setIsSaving(true)
    await setConfig({ apiServiceUrl, retrievalServiceUrl, agentsServiceUrl, akidbUrl })
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    onComplete?.()
  }

  const handleSkip = () => {
    localStorage.setItem(localStorageKey.setupCompleted, 'true')
    onComplete?.()
  }

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage />
      <div className="h-full px-8 overflow-y-auto flex flex-col gap-2 justify-center">
        <div className="w-full max-w-lg mx-auto">
          {/* Welcome heading */}
          <div className="mb-8 text-center">
            <div className="size-16 bg-secondary/60 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <img
                src="/images/ax-fabric-logo.png"
                alt="Ax-Fabric"
                className="size-10 object-contain"
                onError={(e) => {
                  // Fallback if logo not yet added
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
            <h1 className="font-studio font-medium text-2xl mb-2">
              {t('setup:welcome', { defaultValue: 'Welcome to Ax-Fabric' })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('setup:configureServices', {
                defaultValue:
                  'Connect Ax-Fabric to your backend services to get started. You can update these URLs anytime in Settings.',
              })}
            </p>
          </div>

          {/* Service URL fields */}
          <div className="flex flex-col gap-3 bg-background rounded-xl border p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              Backend Service URLs
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">API Service</label>
              <p className="text-xs text-muted-foreground mb-1">
                OpenAI-compatible model inference endpoint
              </p>
              <Input
                value={apiServiceUrl}
                onChange={(e) => setApiServiceUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Retrieval Service</label>
              <p className="text-xs text-muted-foreground mb-1">
                Document parsing, embedding, and semantic search
              </p>
              <Input
                value={retrievalServiceUrl}
                onChange={(e) => setRetrievalServiceUrl(e.target.value)}
                placeholder="http://127.0.0.1:8001"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Agents Service</label>
              <p className="text-xs text-muted-foreground mb-1">
                AI agent orchestration and execution
              </p>
              <Input
                value={agentsServiceUrl}
                onChange={(e) => setAgentsServiceUrl(e.target.value)}
                placeholder="http://127.0.0.1:8002"
                className="h-8 text-sm font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">AkiDB</label>
              <p className="text-xs text-muted-foreground mb-1">
                Vector database REST API
              </p>
              <Input
                value={akidbUrl}
                onChange={(e) => setAkidbUrl(e.target.value)}
                placeholder="http://127.0.0.1:8003"
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 mt-6 justify-end">
            <Button variant="ghost" size="sm" onClick={handleSkip}>
              {t('setup:skipForNow', { defaultValue: 'Skip for now' })}
            </Button>
            <Button size="sm" onClick={handleGetStarted} disabled={isSaving}>
              {isSaving
                ? t('setup:saving', { defaultValue: 'Saving...' })
                : t('setup:getStarted', { defaultValue: 'Get Started' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
