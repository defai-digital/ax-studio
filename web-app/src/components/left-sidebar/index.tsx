import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'
import { PerformanceMonitor } from '@/components/PerformanceMonitor'
import { ThemeToggle } from '@/components/ThemeToggle'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { Zap } from 'lucide-react'
import { IconBrandDiscord } from '@tabler/icons-react'
import {
  SettingsIcon,
  type SettingsIconHandle,
} from '@/components/animated-icon/settings'
import { useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function LeftSidebar() {
  const { t } = useTranslation()
  const settingsIconRef = useRef<SettingsIconHandle>(null)

  return (
    <div className="relative z-50">
      <Sidebar variant="sidebar" collapsible="icon">
        {/* Header — matches Figma: px-4 pt-4 pb-3 */}
        <SidebarHeader className="flex px-3 pt-4 pb-3">
          {/* Collapsed: logo icon only (above the trigger row) */}
          {!IS_MACOS && (
            <div className="hidden group-data-[collapsible=icon]:flex justify-center mb-1">
              <div className="size-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Zap className="size-4 text-white" strokeWidth={2.5} />
              </div>
            </div>
          )}
          <div
            className={cn(
              'flex items-center w-full justify-between px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
              IS_MACOS && 'justify-end',
            )}
          >
            {/* Expanded: logo + title + badge */}
            {!IS_MACOS && (
              <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:hidden">
                <div className="size-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Zap className="size-3.5 text-white" strokeWidth={2.5} />
                </div>
                <div className="flex items-center">
                  <span className="text-sidebar-foreground font-semibold tracking-tight" style={{ fontSize: '14px' }}>
                    Ax Studio
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-sidebar-primary/20 text-sidebar-primary ml-1.5">
                    v2
                  </span>
                </div>
              </div>
            )}
            <SidebarTrigger className="p-1.5 rounded-lg text-sidebar-foreground/30 hover:text-sidebar-foreground hover:bg-sidebar-accent! relative z-50 group-data-[collapsible=icon]:hidden" />
          </div>
          <NavMain />
        </SidebarHeader>

        {/* Divider — matches Figma: mx-4 mb-3 between nav and threads */}
        <SidebarSeparator className="mx-4 mb-3 group-data-[collapsible=icon]:hidden" />

        {/* Scrollable content — matches Figma: flex-1 overflow-y-auto */}
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          <NavProjects />
          <NavChats />
        </SidebarContent>

        {/* Footer — matches Figma: border-top, pt-2, Settings + Discord */}
        <SidebarFooter className="border-t border-sidebar-border pt-2">
          <PerformanceMonitor />

          {/* Settings + links — matches Figma: px-3 pb-3 space-y-0.5 */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip={t('common:settings')}
                onMouseEnter={() => settingsIconRef.current?.startAnimation()}
                onMouseLeave={() => settingsIconRef.current?.stopAnimation()}
              >
                <Link to={route.settings.general} className="group-data-[collapsible=icon]:justify-center">
                  <SettingsIcon ref={settingsIconRef} className="text-foreground/70" size={16} />
                  <span className="group-data-[collapsible=icon]:hidden">{t('common:settings')}</span>
                  <span className="ml-auto text-[10px] text-sidebar-foreground/20 group-data-[collapsible=icon]:hidden">
                    ⌘,
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="px-1 pb-1 space-y-0.5 group-data-[collapsible=icon]:hidden">
            <ThemeToggle />
            <DownloadManagement />
            <a
              href="https://discord.gg/cd5AD5zY6U"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
            >
              <IconBrandDiscord size={16} className="shrink-0" />
              <span>Share Feedback</span>
            </a>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
