import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMatches } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import { PlatformFeatures, PlatformFeature } from '@/lib/platform'
import {
  Settings,
  Palette,
  Shield,
  Keyboard,
  Plug,
  Bot,
  FileText,
  Wrench,
  Cpu,
  Cog,
  Server,
  Globe,
  Brain,
  Users,
  Link as LinkIcon,
  Route,
  ShieldCheck,
} from 'lucide-react'

type SettingsMenuItem = {
  title: string
  route: string
  isEnabled: boolean
  icon: React.ReactNode
  group: 'App' | 'AI' | 'Advanced' | 'Other'
}

const SettingsMenu = () => {
  const { t } = useTranslation()
  const matches = useMatches()

  const menuSettings: SettingsMenuItem[] = [
    // App group
    {
      title: 'common:general',
      route: route.settings.general,
      isEnabled: true,
      icon: <Settings className="size-3.5" />,
      group: 'App',
    },
    {
      title: 'common:interface',
      route: route.settings.interface,
      isEnabled: true,
      icon: <Palette className="size-3.5" />,
      group: 'App',
    },
    {
      title: 'common:privacy',
      route: route.settings.privacy,
      isEnabled: true,
      icon: <Shield className="size-3.5" />,
      group: 'App',
    },
    {
      title: 'common:guardrails',
      route: route.settings.guardrails,
      isEnabled: true,
      icon: <ShieldCheck className="size-3.5" />,
      group: 'App',
    },
    {
      title: 'common:keyboardShortcuts',
      route: route.settings.shortcuts,
      isEnabled: true,
      icon: <Keyboard className="size-3.5" />,
      group: 'App',
    },
    // AI group
    {
      title: 'common:modelProviders',
      route: route.settings.model_providers,
      isEnabled: true,
      icon: <Plug className="size-3.5" />,
      group: 'AI',
    },
    {
      title: 'common:assistants',
      route: route.settings.assistant,
      isEnabled: true,
      icon: <Bot className="size-3.5" />,
      group: 'AI',
    },
    {
      title: 'common:attachments',
      route: route.settings.attachments,
      isEnabled: true,
      icon: <FileText className="size-3.5" />,
      group: 'AI',
    },
    {
      title: 'common:mcp-servers',
      route: route.settings.mcp_servers,
      isEnabled: true,
      icon: <Wrench className="size-3.5" />,
      group: 'AI',
    },
    {
      title: 'common:llmRouter',
      route: route.settings.llm_router,
      isEnabled: true,
      icon: <Route className="size-3.5" />,
      group: 'AI',
    },
    // Advanced group
    {
      title: 'common:hardware',
      route: route.settings.hardware,
      isEnabled: true,
      icon: <Cpu className="size-3.5" />,
      group: 'Advanced',
    },
    {
      title: 'common:engineSettings',
      route: route.settings.engine_settings,
      isEnabled: PlatformFeatures[PlatformFeature.LOCAL_INFERENCE],
      icon: <Cog className="size-3.5" />,
      group: 'Advanced',
    },
    {
      title: 'common:local_api_server',
      route: route.settings.local_api_server,
      isEnabled: true,
      icon: <Server className="size-3.5" />,
      group: 'Advanced',
    },
    {
      title: 'common:https_proxy',
      route: route.settings.https_proxy,
      isEnabled: true,
      icon: <Globe className="size-3.5" />,
      group: 'Advanced',
    },
    // Other group
    {
      title: 'common:memory',
      route: route.settings.memory,
      isEnabled: true,
      icon: <Brain className="size-3.5" />,
      group: 'Other',
    },
    {
      title: 'common:agentTeams',
      route: route.settings.agent_teams,
      isEnabled: true,
      icon: <Users className="size-3.5" />,
      group: 'Other',
    },
    {
      title: 'common:integrations',
      route: route.settings.integrations,
      isEnabled: true,
      icon: <LinkIcon className="size-3.5" />,
      group: 'Other',
    },
  ]

  const groups: { key: string; label: string }[] = [
    { key: 'App', label: 'App' },
    { key: 'AI', label: 'AI' },
    { key: 'Advanced', label: 'Advanced' },
    { key: 'Other', label: 'Other' },
  ]

  return (
    <div
      className="w-56 shrink-0 border-r border-border/40 py-5 px-3 flex flex-col overflow-y-auto bg-muted/10"
      style={{ scrollbarWidth: 'none' }}
    >
      {groups.map((group, groupIndex) => {
        const groupItems = menuSettings.filter(
          (m) => m.group === group.key && m.isEnabled
        )
        if (groupItems.length === 0) return null

        return (
          <div key={group.key} className="w-full flex flex-col">
            {groupIndex > 0 && <div className="h-px bg-border/40 my-3" />}
            <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/40 px-3 mb-2">
              {group.label}
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

export default SettingsMenu
