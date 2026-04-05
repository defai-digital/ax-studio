import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Shield } from 'lucide-react'

export const Route = createFileRoute(route.settings.privacy)({
  component: Privacy,
})

function Privacy() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div
              className="size-7 rounded-lg flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              }}
            >
              <Shield className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              {t('common:privacy')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="font-medium text-foreground text-base">
                      {t('common:privacy')}
                    </h1>
                  </div>
                }
              >
                <CardItem
                  description={
                    <div className="text-foreground">
                      <p>{t('settings:privacy.privacyPolicy')}</p>
                      <ul className="list-disc pl-4 space-y-1 mt-4">
                        <li className="font-medium">
                          {t('settings:privacy.promise1')}
                        </li>
                        <li className="font-medium">
                          {t('settings:privacy.promise2')}
                        </li>
                        <li className="font-medium">
                          {t('settings:privacy.promise3')}
                        </li>
                      </ul>
                    </div>
                  }
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
