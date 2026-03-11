/**
 * Ax-Studio Setup / Onboarding Screen
 *
 * Shown on first launch. Simple welcome screen before entering the main UI.
 */

import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { Button } from '@/components/ui/button'
import HeaderPage from './HeaderPage'

interface SetupScreenProps {
  onComplete?: () => void
}

function SetupScreen({ onComplete }: SetupScreenProps) {
  const { t } = useTranslation()

  const handleGetStarted = () => {
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
                src="/images/ax-studio-logo.png"
                alt="Ax-Studio"
                className="size-10 object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
            <h1 className="font-studio font-medium text-2xl mb-2">
              {t('setup:welcome', { defaultValue: 'Welcome to Ax-Studio' })}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('setup:getStartedDescription', {
                defaultValue:
                  'Your AI desktop app is ready. Configure your providers and start chatting.',
              })}
            </p>
          </div>

          {/* Action button */}
          <div className="flex justify-center mt-6">
            <Button size="sm" onClick={handleGetStarted}>
              {t('setup:getStarted', { defaultValue: 'Get Started' })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SetupScreen
