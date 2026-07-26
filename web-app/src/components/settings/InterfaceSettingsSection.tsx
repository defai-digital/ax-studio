import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import {
  fontSizeOptions,
  useInterfaceSettings,
  ACCENT_COLORS,
  readableForeground,
  type FontSize,
} from '@/hooks/settings/useInterfaceSettings'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function FontSizeSwitcher() {
  const { fontSize, setFontSize } = useInterfaceSettings()
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-[120px] justify-between rounded-lg h-8 text-[12px]"
          title={t('common:adjustFontSize')}
        >
          {fontSizeOptions.find((item) => item.value === fontSize)?.label ||
            t('common:medium')}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl">
        {fontSizeOptions.map((item) => (
          <DropdownMenuItem
            key={item.value}
            className={cn(
              'cursor-pointer my-0.5 text-[12px]',
              fontSize === item.value && 'bg-primary/10 text-primary'
            )}
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
          <button
            key={color.value}
            type="button"
            title={color.name}
            aria-label={color.name}
            aria-pressed={isSelected}
            onClick={() => setAccentColor(color.value)}
            className={cn(
              'size-7 rounded-full border-2 transition-all duration-200 cursor-pointer hover:scale-110 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isSelected
                ? 'ring-2 ring-offset-2 ring-primary border-transparent'
                : 'border-border/50'
            )}
            style={{
              backgroundColor:
                color.thumb === '#3F3F46' ? 'var(--background)' : color.thumb,
            }}
          >
            {isSelected && (
              <Check
                className="size-3 drop-shadow-sm"
                style={{
                  // White check fails WCAG AA on light accent swatches; the
                  // gray swatch renders --background, so follow the theme
                  // foreground there instead.
                  color:
                    color.thumb === '#3F3F46'
                      ? 'var(--foreground)'
                      : readableForeground(color.thumb),
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Appearance (theme/font size/accent) settings as a self-contained card.
 * Merged into /settings/general under Electron (migration matrix §1).
 */
export function InterfaceSettingsSection() {
  const { t } = useTranslation()
  const { resetInterface } = useInterfaceSettings()

  return (
    <Card title={t('settings:general.appearance')}>
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
        title={t('settings:interface.accent', {
          defaultValue: 'Accent color',
        })}
        description={t('settings:interface.accentDesc', {
          defaultValue: 'Customize the accent color of the application.',
        })}
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
              toast.success(t('settings:interface.resetInterfaceSuccess'), {
                id: 'reset-interface',
                description: t('settings:interface.resetInterfaceSuccessDesc'),
              })
            }}
          >
            {t('common:reset')}
          </Button>
        }
      />
    </Card>
  )
}
