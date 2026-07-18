import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { SettingsMenu } from '@/components/common/SettingsMenu'
import { HeaderPage } from '@/containers/HeaderPage'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Shield } from 'lucide-react'
import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout'
import { AX_STUDIO_EXTERNAL_LINKS } from '@/constants/external-links'

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
          style={{ scrollbarWidth: 'thin' }}
        >
          <SettingsPageLayout icon={Shield} title={t('common:privacy')} />
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
                        <li className="font-medium">
                          {t('settings:privacy.promise4')}
                        </li>
                      </ul>
                      <p className="mt-4 text-muted-foreground">
                        {t('settings:privacy.aiDisclosure')}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                        <a
                          href={AX_STUDIO_EXTERNAL_LINKS.privacy}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {t('settings:privacy.readPrivacyPolicy')}
                        </a>
                        <a
                          href={AX_STUDIO_EXTERNAL_LINKS.terms}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {t('settings:privacy.readTerms')}
                        </a>
                        <a
                          href={AX_STUDIO_EXTERNAL_LINKS.aiContentReport}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {t('settings:privacy.reportAiContent')}
                        </a>
                      </div>
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
