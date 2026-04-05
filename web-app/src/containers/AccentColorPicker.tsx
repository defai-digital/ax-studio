import { cn } from '@/lib/utils'
import {
  useInterfaceSettings,
  ACCENT_COLORS,
} from '@/hooks/settings/useInterfaceSettings'
import { Check } from 'lucide-react'

export function AccentColorPicker() {
  const { accentColor, setAccentColor } = useInterfaceSettings()

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {ACCENT_COLORS.map((color) => {
        const isSelected = color.value === accentColor
        return (
          <button
            key={color.value}
            title={color.name}
            onClick={() => setAccentColor(color.value)}
            className={cn(
              'size-6 rounded-full border-2 transition-all duration-200 cursor-pointer hover:scale-110 flex items-center justify-center',
              isSelected
                ? 'ring-2 ring-offset-2 ring-primary border-transparent'
                : 'border-border/50'
            )}
            style={{
              backgroundColor: color.thumb === "#3F3F46" ? 'var(--background)' : color.thumb,
            }}
          >
            {isSelected && (
              <Check className="size-3 text-white drop-shadow-sm" />
            )}
          </button>
        )
      })}
    </div>
  )
}
