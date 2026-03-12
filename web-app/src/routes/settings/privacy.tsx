import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.privacy as any)({
  component: Privacy,
})

function Privacy() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
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
  )
}
