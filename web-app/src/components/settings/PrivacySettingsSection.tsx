import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { AX_STUDIO_EXTERNAL_LINKS } from '@/constants/external-links'

/**
 * Privacy policy card. Used by the standalone /settings/privacy page (Tauri)
 * and merged into /settings/general under Electron (migration matrix §1).
 */
export function PrivacySettingsSection() {
  const { t } = useTranslation()

  return (
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
              <li className="font-medium">{t('settings:privacy.promise1')}</li>
              <li className="font-medium">{t('settings:privacy.promise2')}</li>
              <li className="font-medium">{t('settings:privacy.promise3')}</li>
              <li className="font-medium">{t('settings:privacy.promise4')}</li>
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
  )
}
