import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SettingsPageLayoutProps {
  icon: LucideIcon
  title: React.ReactNode
  subtitle?: string
  /** Optional custom gradient; defaults to tokenized brand gradient */
  gradient?: string
}

export function SettingsPageLayout({
  icon: Icon,
  title,
  subtitle,
  gradient,
}: SettingsPageLayoutProps) {
  return (
    <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
      <div
        className={cn(
          'size-7 rounded-lg flex items-center justify-center',
          !gradient && 'bg-brand-gradient'
        )}
        style={gradient ? { background: gradient } : undefined}
      >
        <Icon className="size-3.5 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <div>
        <h1
          className="text-foreground tracking-tight"
          style={{ fontSize: '16px', fontWeight: 600 }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  )
}
