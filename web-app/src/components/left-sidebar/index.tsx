import { DownloadManagement } from '@/containers/DownloadManegement'
import { NavChats } from './NavChats'
import { NavMain } from './NavMain'
import { NavProjects } from './NavProjects'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { IconBrandDiscord } from '@tabler/icons-react'

export function LeftSidebar() {
  return (
    <div className='relative z-50'>
      <Sidebar variant="floating" collapsible="offcanvas">
        <SidebarHeader className="flex px-1">
          <div className={cn("flex items-center w-full justify-between", IS_MACOS && "justify-end")}>
            {!IS_MACOS && <span className="ml-2 font-medium font-studio">Ax-Studio</span>}
            <SidebarTrigger className="text-muted-foreground rounded-full hover:bg-sidebar-foreground/8! -mt-0.5 relative z-50" />
          </div>
          <NavMain />
        </SidebarHeader>
        <SidebarContent className="mask-b-from-95% mask-t-from-98%">
          <NavProjects />
          <NavChats />
        </SidebarContent>
        <SidebarFooter>
          <DownloadManagement />
          <a
            href="https://discord.gg/cd5AD5zY6U"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-sidebar-foreground/8"
          >
            <IconBrandDiscord size={16} className="shrink-0" />
            <span>Share Feedback</span>
          </a>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
