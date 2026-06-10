import type { LucideIcon } from 'lucide-react'

interface SettingsPageLayoutProps {
  icon: LucideIcon
  title: React.ReactNode
  subtitle?: string
  gradient?: string
}

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #6366f1, #8b5cf6)'

export default function SettingsPageLayout({
  icon: Icon,
  title,
  subtitle,
  gradient = DEFAULT_GRADIENT,
}: SettingsPageLayoutProps) {
  return (
    <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
      <div
        className="size-7 rounded-lg flex items-center justify-center"
        style={{ background: gradient }}
      >
        <Icon className="size-3.5 text-white" strokeWidth={2.5} />
      </div>
      <div>
        <h1
          className="text-foreground tracking-tight"
          style={{ fontSize: '16px', fontWeight: 600 }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
