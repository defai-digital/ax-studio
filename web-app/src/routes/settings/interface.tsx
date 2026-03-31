import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import { FontSizeSwitcher } from '@/containers/FontSizeSwitcher'
import { AccentColorPicker } from '@/containers/AccentColorPicker'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Palette } from 'lucide-react'

export const Route = createFileRoute(route.settings.interface)({
  component: InterfaceSettings,
})

function InterfaceSettings() {
  const { t } = useTranslation()
  const { resetInterface } = useInterfaceSettings()

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
              <Palette className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              {t('settings:interface.title')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              <Card title={t('settings:interface.title')}>
                <CardItem
                  title={t('settings:interface.theme')}
                  description={t('settings:interface.themeDesc')}
                  column
                  actions={<ThemeSwitcher />}
                />
                <CardItem
                  title={t('settings:interface.fontSize')}
                  description={t('settings:interface.fontSizeDesc')}
                  actions={<FontSizeSwitcher />}
                />
                <CardItem
                  title="Accent color"
                  description="Customize the accent color of the application."
                  className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                  actions={<AccentColorPicker />}
                />
                <CardItem
                  title={t('settings:interface.resetToDefault')}
                  description={t('settings:interface.resetToDefaultDesc')}
                  actions={
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        resetInterface()
                        toast.success(
                          t('settings:interface.resetInterfaceSuccess'),
                          {
                            id: 'reset-interface',
                            description: t(
                              'settings:interface.resetInterfaceSuccessDesc'
                            ),
                          }
                        )
                      }}
                    >
                      {t('common:reset')}
                    </Button>
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
