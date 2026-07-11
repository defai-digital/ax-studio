import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMatches } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { localStorageKey } from '@/constants/localStorage'
import {
  isStorageFlagEnabled,
  safeStorageGetItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'

import { isPlatformTauri } from '@/lib/platform/utils'
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
  Route,
  ShieldCheck,
  Puzzle,
  Database,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

type SettingsMenuItem = {
  title: string
  route: string
  isEnabled: boolean
  icon: React.ReactNode
  group: 'App' | 'AI' | 'Advanced' | 'Other'
  /** When true, item is hidden in simplified workspace modes unless advanced is expanded */
  advanced?: boolean
}

type WorkspaceModeId =
  | 'simple-chat'
  | 'local-private-ai'
  | 'developer-agent'
  | 'knowledge-workspace'
  | 'controlled-workspace'

const ADVANCED_STORAGE_KEY = 'settings-show-advanced'

/** Modes that start with advanced settings collapsed */
const SIMPLIFIED_MODES = new Set<WorkspaceModeId>([
  'simple-chat',
  'knowledge-workspace',
])

function readWorkspaceMode(): WorkspaceModeId {
  const stored = safeStorageGetItem(
    localStorage,
    localStorageKey.workspaceMode,
    'SettingsMenu'
  )
  if (
    stored === 'simple-chat' ||
    stored === 'local-private-ai' ||
    stored === 'developer-agent' ||
    stored === 'knowledge-workspace' ||
    stored === 'controlled-workspace'
  ) {
    return stored
  }
  // Default matches onboarding default — full settings for power users
  return 'developer-agent'
}

export function SettingsMenu() {
  const { t } = useTranslation()
  const matches = useMatches()
  const workspaceMode = useMemo(() => readWorkspaceMode(), [])
  const startsSimplified = SIMPLIFIED_MODES.has(workspaceMode)

  const [showAdvanced, setShowAdvanced] = useState(() => {
    if (!startsSimplified) return true
    return isStorageFlagEnabled(
      localStorage,
      ADVANCED_STORAGE_KEY,
      'SettingsMenu'
    )
  })

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
      advanced: true,
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
      title: 'common:knowledgeBase',
      route: route.settings.knowledge_base,
      isEnabled: true,
      icon: <Database className="size-3.5" />,
      group: 'AI',
    },
    {
      title: 'common:mcp-servers',
      route: route.settings.mcp_servers,
      isEnabled: true,
      icon: <Wrench className="size-3.5" />,
      group: 'AI',
      advanced: true,
    },
    {
      title: 'common:llmRouter',
      route: route.settings.llm_router,
      isEnabled: true,
      icon: <Route className="size-3.5" />,
      group: 'AI',
      advanced: true,
    },
    // Advanced group
    {
      title: 'common:hardware',
      route: route.settings.hardware,
      isEnabled: true,
      icon: <Cpu className="size-3.5" />,
      group: 'Advanced',
      advanced: true,
    },
    {
      title: 'common:engineSettings',
      route: route.settings.engine_settings,
      isEnabled: isPlatformTauri(),
      icon: <Cog className="size-3.5" />,
      group: 'Advanced',
      advanced: true,
    },
    {
      title: 'common:local_api_server',
      route: route.settings.local_api_server,
      isEnabled: true,
      icon: <Server className="size-3.5" />,
      group: 'Advanced',
      advanced: true,
    },
    {
      title: 'common:https_proxy',
      route: route.settings.https_proxy,
      isEnabled: true,
      icon: <Globe className="size-3.5" />,
      group: 'Advanced',
      advanced: true,
    },
    // Other group
    {
      title: 'common:extensions',
      route: route.settings.extensions,
      isEnabled: true,
      icon: <Puzzle className="size-3.5" />,
      group: 'Other',
      advanced: true,
    },
  ]

  // If the user is already on an advanced route, expand so they don't get stuck
  useEffect(() => {
    if (showAdvanced || !startsSimplified) return
    const onAdvancedRoute = menuSettings.some(
      (item) =>
        item.advanced &&
        item.isEnabled &&
        matches.some(
          (match) =>
            match.pathname === item.route ||
            (item.route === route.settings.model_providers &&
              (match.routeId === '/settings/providers/' ||
                match.routeId === '/settings/providers/$providerName'))
        )
    )
    if (onAdvancedRoute) {
      setShowAdvanced(true)
      safeStorageSetItem(localStorage, ADVANCED_STORAGE_KEY, 'true', 'SettingsMenu')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when route matches change
  }, [matches, showAdvanced, startsSimplified])

  const toggleAdvanced = () => {
    setShowAdvanced((prev) => {
      const next = !prev
      safeStorageSetItem(
        localStorage,
        ADVANCED_STORAGE_KEY,
        next ? 'true' : 'false',
        'SettingsMenu'
      )
      return next
    })
  }

  const visibleItems = menuSettings.filter((m) => {
    if (!m.isEnabled) return false
    if (!startsSimplified || showAdvanced) return true
    return !m.advanced
  })

  const groups: { key: string; labelKey: string }[] = [
    { key: 'App', labelKey: 'common:settingsGroupApp' },
    { key: 'AI', labelKey: 'common:settingsGroupAi' },
    { key: 'Advanced', labelKey: 'common:settingsGroupAdvanced' },
    { key: 'Other', labelKey: 'common:settingsGroupOther' },
  ]

  return (
    <div
      className="w-56 shrink-0 border-r border-border/40 py-5 px-3 flex flex-col overflow-y-auto bg-muted/10"
      style={{ scrollbarWidth: 'thin' }}
    >
      {groups.map((group, groupIndex) => {
        const groupItems = visibleItems.filter((m) => m.group === group.key)
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

      {startsSimplified && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={toggleAdvanced}
            className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? (
              <ChevronUp className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
            <span>
              {showAdvanced
                ? t('common:hideAdvancedSettings')
                : t('common:showAdvancedSettings')}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
