import { Plus, Search } from 'lucide-react'
import { route } from '@/constants/routes'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { PlatformMetaKey } from '@/components/common/PlatformMetaKey'

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
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-primary-foreground font-medium shadow-brand overflow-hidden whitespace-nowrap group-data-[collapsible=icon]:hidden bg-brand-gradient"
            style={{ fontSize: '13px' }}
          >
            <Plus className="size-3.5 shrink-0" strokeWidth={2.5} />
            <span>{t('common:newChat')}</span>
            <span className="ml-auto text-xs text-primary-foreground/50">
              <PlatformMetaKey />N
            </span>
          </Link>
          {/* Collapsed: icon-only with tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={route.home}
                aria-label={t('common:newChat')}
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
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground overflow-hidden whitespace-nowrap group-data-[collapsible=icon]:hidden"
            style={{ fontSize: '13px' }}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">{t('common:search')}...</span>
            <kbd className="text-xs bg-sidebar-accent border border-sidebar-border px-1.5 py-0.5 rounded text-sidebar-foreground/50">
              <PlatformMetaKey />K
            </kbd>
          </button>
          {/* Collapsed: icon-only with tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={t('common:search')}
                className="hidden group-data-[collapsible=icon]:flex p-2.5 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground"
              >
                <Search className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t('common:search')} (<PlatformMetaKey />K)
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Collapsed divider — matches Figma: w-6 h-px my-2 between Search and Hub */}
      <div className="hidden group-data-[collapsible=icon]:block w-6 h-px my-2 mx-auto bg-sidebar-border" />

      {/* Nav — primary workspace destinations. */}
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
                <BlocksIcon
                  ref={hubIconRef}
                  className="text-foreground/70"
                  size={16}
                />
                <span className="group-data-[collapsible=icon]:hidden">
                  {t('common:hub')}
                </span>
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
