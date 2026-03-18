import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Sun, Moon, Laptop, Check } from 'lucide-react'

export function ThemeSwitcher() {
  const { t } = useTranslation()
  const { setTheme, activeTheme } = useTheme()

  const themes = [
    {
      value: 'light' as const,
      label: t('common:light'),
      icon: <Sun className="size-5" />,
      preview: 'bg-white border-zinc-200',
      previewContent: 'text-zinc-900',
    },
    {
      value: 'dark' as const,
      label: t('common:dark'),
      icon: <Moon className="size-5" />,
      preview: 'bg-zinc-900 border-zinc-700',
      previewContent: 'text-zinc-100',
    },
    {
      value: 'auto' as const,
      label: t('common:system'),
      icon: <Laptop className="size-5" />,
      preview: 'bg-gradient-to-br from-white to-zinc-900 border-zinc-400',
      previewContent: 'text-zinc-500',
    },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 w-full">
      {themes.map((theme) => {
        const isSelected = activeTheme === theme.value
        return (
          <button
            key={theme.value}
            onClick={() => setTheme(theme.value)}
            className={cn(
              'relative flex flex-col items-center gap-2.5 p-4 rounded-xl border-2 transition-all cursor-pointer',
              isSelected
                ? 'border-primary shadow-sm shadow-primary/20'
                : 'border-border/50 hover:border-border'
            )}
          >
            <div
              className={cn(
                'w-full h-10 rounded-lg border flex items-center justify-center',
                theme.preview
              )}
            >
              <span className={cn('text-[10px] font-medium', theme.previewContent)}>
                Aa
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  isSelected ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {theme.icon}
              </span>
              <span className="text-[13px] font-medium">{theme.label}</span>
            </div>
            {isSelected && (
              <div className="absolute top-2 right-2 size-4 rounded-full bg-primary flex items-center justify-center">
                <Check className="size-2.5 text-primary-foreground" />
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
