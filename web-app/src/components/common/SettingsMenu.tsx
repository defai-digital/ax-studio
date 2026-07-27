import { Link, useMatches } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

import { BarChart3, Cloud, Cpu, Settings } from 'lucide-react'

type SettingsMenuItem = {
  title: string
  route: string
  icon: React.ReactNode
}

// Electron-only settings surface. Keep integrations here instead of mixing
// connection setup into the primary workspace navigation.
const menuSettings: SettingsMenuItem[] = [
  {
    title: 'common:general',
    route: route.settings.general,
    icon: <Settings className="size-3.5" />,
  },
  {
    title: 'common:axEngine',
    route: route.settings.axEngine,
    icon: <Cpu className="size-3.5" />,
  },
  {
    title: 'common:modelProviders',
    route: route.settings.model_providers,
    icon: <Cloud className="size-3.5" />,
  },
  {
    title: 'common:axBi',
    route: route.settings.axBi,
    icon: <BarChart3 className="size-3.5" />,
  },
]

export function SettingsMenu() {
  const { t } = useTranslation()
  const matches = useMatches()

  return (
    <div
      className="w-56 shrink-0 border-r border-border/40 py-5 px-3 flex flex-col overflow-y-auto bg-muted/10"
      style={{ scrollbarWidth: 'thin' }}
    >
      <div className="flex flex-col gap-0.5">
        {menuSettings.map((menu) => {
          const isActive = matches.some((match) => {
            if (match.pathname === menu.route) return true

            const providerName =
              typeof match.params?.providerName === 'string'
                ? match.params.providerName
                : undefined
            const isProviderDetail =
              match.routeId === '/settings/providers/$providerName'
            const isAxEngineProvider =
              providerName === 'ax-engine' || providerName === 'mlx'

            if (menu.route === route.settings.axEngine) {
              return isProviderDetail && isAxEngineProvider
            }
            if (menu.route === route.settings.model_providers) {
              return (
                match.routeId === '/settings/providers/' ||
                (isProviderDetail && !isAxEngineProvider)
              )
            }
            return false
          })

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
              <span className="truncate flex-1" style={{ fontSize: '13px' }}>
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
}
