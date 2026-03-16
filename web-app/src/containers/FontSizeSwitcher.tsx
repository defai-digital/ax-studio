import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fontSizeOptions, useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown, Check } from 'lucide-react'

export function FontSizeSwitcher() {
  const { fontSize, setFontSize } = useInterfaceSettings()
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-[120px] justify-between rounded-lg h-8 text-[12px]" title={t('common:adjustFontSize')}>
          {fontSizeOptions.find(
            (item: { value: string; label: string }) => item.value === fontSize
          )?.label || t('common:medium')}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl">
        {fontSizeOptions.map((item: { value: string; label: string }) => (
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
