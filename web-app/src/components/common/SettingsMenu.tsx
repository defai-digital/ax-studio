import { Link, useMatches } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

import { Settings, Plug } from 'lucide-react'

type SettingsMenuItem = {
  title: string
  route: string
  icon: React.ReactNode
  group: 'App' | 'AI'
}

// Electron-only settings surface (migration matrix §1): General + Providers.
// Everything else was removed or merged into General.
const menuSettings: SettingsMenuItem[] = [
  {
    title: 'common:general',
    route: route.settings.general,
    icon: <Settings className="size-3.5" />,
    group: 'App',
  },
  {
    title: 'common:modelProviders',
    route: route.settings.model_providers,
    icon: <Plug className="size-3.5" />,
    group: 'AI',
  },
]

const groups: { key: string; labelKey: string }[] = [
  { key: 'App', labelKey: 'common:settingsGroupApp' },
  { key: 'AI', labelKey: 'common:settingsGroupAi' },
]

export function SettingsMenu() {
  const { t } = useTranslation()
  const matches = useMatches()

  return (
    <div
      className="w-56 shrink-0 border-r border-border/40 py-5 px-3 flex flex-col overflow-y-auto bg-muted/10"
      style={{ scrollbarWidth: 'thin' }}
    >
      {groups.map((group, groupIndex) => {
        const groupItems = menuSettings.filter((m) => m.group === group.key)
        if (groupItems.length === 0) return null

        return (
          <div key={group.key} className="w-full flex flex-col">
            {groupIndex > 0 && <div className="h-px bg-border/40 my-3" />}
            <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/60 px-3 mb-2">
              {t(group.labelKey, { defaultValue: group.key })}
            </span>
            <div className="flex flex-col gap-0.5">
              {groupItems.map((menu) => {
                const isActive = matches.some(
                  (match) =>
                    match.pathname === menu.route ||
                    (menu.route === route.settings.model_providers &&
                      (match.routeId === '/settings/providers/' ||
                        match.routeId === '/settings/providers/$providerName'))
                )

                return (
                  <Link
                    key={menu.title}
                    to={menu.route}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    )}
                  >
                    {menu.icon}
                    <span
                      className="truncate flex-1"
                      style={{ fontSize: '13px' }}
                    >
                      {t(menu.title)}
                    </span>
                    {isActive && (
                      <div className="ml-auto size-1.5 rounded-full bg-primary" />
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
