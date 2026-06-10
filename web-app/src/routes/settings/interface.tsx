import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import { fontSizeOptions, useInterfaceSettings, ACCENT_COLORS, type FontSize } from '@/hooks/settings/useInterfaceSettings'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Palette } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import SettingsPageLayout from '@/components/settings/SettingsPageLayout'

function FontSizeSwitcher() {
  const { fontSize, setFontSize } = useInterfaceSettings()
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-[120px] justify-between rounded-lg h-8 text-[12px]" title={t('common:adjustFontSize')}>
          {fontSizeOptions.find((item) => item.value === fontSize)?.label || t('common:medium')}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl">
        {fontSizeOptions.map((item) => (
          <DropdownMenuItem key={item.value}
            className={cn('cursor-pointer my-0.5 text-[12px]', fontSize === item.value && 'bg-primary/10 text-primary')}
            onClick={() => setFontSize(item.value as FontSize)}
          >
            {fontSize === item.value && <Check className="size-3 mr-1.5" />}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AccentColorPicker() {
  const { accentColor, setAccentColor } = useInterfaceSettings()
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {ACCENT_COLORS.map((color) => {
        const isSelected = color.value === accentColor
        return (
          <button key={color.value} title={color.name} onClick={() => setAccentColor(color.value)}
            className={cn('size-6 rounded-full border-2 transition-all duration-200 cursor-pointer hover:scale-110 flex items-center justify-center',
              isSelected ? 'ring-2 ring-offset-2 ring-primary border-transparent' : 'border-border/50'
            )}
            style={{ backgroundColor: color.thumb === '#3F3F46' ? 'var(--background)' : color.thumb }}
          >
            {isSelected && <Check className="size-3 text-white drop-shadow-sm" />}
          </button>
        )
      })}
    </div>
  )
}

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
          <SettingsPageLayout icon={Palette} title={t('settings:interface.title')} />
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
