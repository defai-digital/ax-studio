import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import SettingsPageLayout from '@/components/settings/SettingsPageLayout'
import AkidbConfigPanel from '@/containers/AkidbConfigPanel'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Database } from 'lucide-react'

export const Route = createFileRoute(route.settings.knowledge_base)({
  component: KnowledgeBase,
})

function KnowledgeBase() {
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
          <SettingsPageLayout
            icon={Database}
            title={t('common:knowledgeBase', { defaultValue: 'Knowledge Base' })}
            subtitle="Sync a local folder so the AI can search and cite your own documents"
            gradient="linear-gradient(135deg, #0d9488, #14b8a6)"
          />
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              <AkidbConfigPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
