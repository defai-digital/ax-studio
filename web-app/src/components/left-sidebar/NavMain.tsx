import { Bot, ChartNoAxesCombined, Plus, Search, Wrench } from 'lucide-react'
import { route } from '@/constants/routes'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/react-i18next-compat'

import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { BlocksIcon, type BlocksIconHandle } from '../animated-icon/blocks'
import { SearchDialog } from '@/containers/dialogs/SearchDialog'
import { useSearchDialog } from '@/hooks/ui/useSearchDialog'
import { CollapsedRecentChats } from '@/components/left-sidebar/CollapsedRecentChats'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export function NavMain() {
  const { t } = useTranslation()
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchDialog()

  // Hub nav item (separate section matching Figma)
  const hubIconRef = useRef<BlocksIconHandle>(null)

  return (
    <>
      {/* Primary Actions — matches Figma px-3 pb-3 space-y-1.5 */}
      <div className="space-y-1.5 pb-3 overflow-hidden group-data-[collapsible=icon]:space-y-1 group-data-[collapsible=icon]:pb-0">
        {/* New Chat — gradient primary action */}
        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <Link
            to={route.home}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-white font-medium shadow-sm overflow-hidden whitespace-nowrap group-data-[collapsible=icon]:hidden"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              fontSize: '13px',
              boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
            }}
          >
            <Plus className="size-3.5 shrink-0" strokeWidth={2.5} />
            <span>{t('common:newChat')}</span>
            <span className="ml-auto text-[10px] text-white/50">⌘N</span>
          </Link>
          {/* Collapsed: icon-only with tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={route.home}
                className="hidden group-data-[collapsible=icon]:flex p-2.5 rounded-lg bg-sidebar-primary/20 hover:bg-sidebar-primary/30 transition-colors text-sidebar-primary mb-1"
              >
                <Plus className="size-4" strokeWidth={2.5} />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{t('common:newChat')}</TooltipContent>
          </Tooltip>
        </div>

        {/* Search — secondary search bar */}
        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground overflow-hidden whitespace-nowrap group-data-[collapsible=icon]:hidden"
            style={{ fontSize: '13px' }}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">{t('common:search')}...</span>
            <kbd className="text-[10px] bg-sidebar-accent border border-sidebar-border px-1.5 py-0.5 rounded text-sidebar-foreground/30">
              ⌘K
            </kbd>
          </button>
          {/* Collapsed: icon-only with tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSearchOpen(true)}
                className="hidden group-data-[collapsible=icon]:flex p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground"
              >
                <Search className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('common:search')} (⌘K)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Collapsed divider — matches Figma: w-6 h-px my-2 between Search and Hub */}
      <div className="hidden group-data-[collapsible=icon]:block w-6 h-px my-2 mx-auto bg-sidebar-border" />

      {/* Nav — workspace destinations. These surface the app's differentiating
          capabilities (model hub, assistants, MCP tools) that were otherwise
          reachable only via Settings. */}
      <div className="pb-2 group-data-[collapsible=icon]:pb-0 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t('common:hub')}
              onMouseEnter={() => hubIconRef.current?.startAnimation()}
              onMouseLeave={() => hubIconRef.current?.stopAnimation()}
            >
              <Link to={route.hub.index}>
                <BlocksIcon ref={hubIconRef} className="text-foreground/70" size={16} />
                <span className="group-data-[collapsible=icon]:hidden">{t('common:hub')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('common:assistants')}>
              <Link to={route.settings.assistant}>
                <Bot className="text-foreground/70" size={16} />
                <span className="group-data-[collapsible=icon]:hidden">{t('common:assistants')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('common:axBi')}>
              <Link to={route.axBi}>
                <ChartNoAxesCombined className="text-foreground/70" size={16} />
                <span className="group-data-[collapsible=icon]:hidden">{t('common:axBi')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('common:tools')}>
              <Link to={route.settings.mcp_servers}>
                <Wrench className="text-foreground/70" size={16} />
                <span className="group-data-[collapsible=icon]:hidden">{t('common:tools')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Collapsed-only: recent chats flyout (Chats list is hidden when collapsed) */}
          <CollapsedRecentChats />
        </SidebarMenu>
      </div>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
