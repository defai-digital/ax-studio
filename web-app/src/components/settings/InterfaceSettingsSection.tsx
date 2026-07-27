import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import {
  fontSizeOptions,
  useInterfaceSettings,
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

/**
 * Appearance (theme/font size) settings as a self-contained card.
 *
 * The accent preference intentionally remains in the underlying store so
 * existing installations keep their chosen colors. It is not exposed here:
 * "accent" is design-system terminology, and the choice adds complexity
 * without supporting a core Studio workflow.
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
