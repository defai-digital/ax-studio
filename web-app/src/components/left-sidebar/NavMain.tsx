import { AudioLines, LayoutList, LucideIcon, Mic, Plus, Search } from 'lucide-react'
import { route } from '@/constants/routes'

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { useTranslation } from '@/i18n/react-i18next-compat'

import { Link, useNavigate } from '@tanstack/react-router'
import { PlatformMetaKey } from '@/containers/PlatformMetaKey'
import React, { useRef } from 'react'
import {
  FolderPlusIcon,
  type FolderPlusIconHandle,
} from '@/components/animated-icon/folder-plus'
import {
  type MessageCircleIconHandle,
} from '@/components/animated-icon/message-circle'
import { BlocksIcon, type BlocksIconHandle } from '../animated-icon/blocks'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { SearchDialog } from '@/containers/dialogs/SearchDialog'
import WorkspaceChatsDialog from '@/containers/dialogs/WorkspaceChatsDialog'
import SpeechToTextDialog from '@/containers/dialogs/SpeechToTextDialog'
import TextToSpeechDialog from '@/containers/dialogs/TextToSpeechDialog'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useSearchDialog } from '@/hooks/useSearchDialog'
import { useProjectDialog } from '@/hooks/useProjectDialog'
import { useWorkspaceChatsDialog } from '@/hooks/useWorkspaceChatsDialog'
import { useSpeechToTextDialog } from '@/hooks/useSpeechToTextDialog'
import { useTextToSpeechDialog } from '@/hooks/useTextToSpeechDialog'

type AnimatedIconHandle =
  | FolderPlusIconHandle
  | MessageCircleIconHandle
  | BlocksIconHandle

type NavItem = {
  title: string
  url?: string
  icon?: LucideIcon | React.ComponentType<{ className?: string }>
  animatedIcon?: React.ForwardRefExoticComponent<
    {
      className?: string
      size?: number
    } & React.RefAttributes<AnimatedIconHandle>
  >
  isActive?: boolean
  shortcut?: React.ReactNode
  onClick?: () => void
}

function NavItemWithAnimatedIcon({
  item,
  label,
}: {
  item: NavItem
  label: string
}) {
  const iconRef = useRef<AnimatedIconHandle>(null)
  const AnimatedIcon = item.animatedIcon!

  const content = (
    <>
      <AnimatedIcon ref={iconRef} className="text-foreground/70" size={16} />
      <span className="group-data-[collapsible=icon]:hidden">{label}</span>
      <span className="group-data-[collapsible=icon]:hidden">
        {item.shortcut}
      </span>
    </>
  )

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild={!!item.url}
        isActive={item.isActive}
        tooltip={label}
        onMouseEnter={() => iconRef.current?.startAnimation()}
        onMouseLeave={() => iconRef.current?.stopAnimation()}
        onClick={item.onClick}
      >
        {item.url ? <Link to={item.url}>{content}</Link> : content}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavMain() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { addFolder } = useThreadManagement()
  const { open: searchOpen, setOpen: setSearchOpen } = useSearchDialog()
  const { open: projectDialogOpen, setOpen: setProjectDialogOpen } =
    useProjectDialog()
  const { open: workspaceChatsOpen, setOpen: setWorkspaceChatsOpen } =
    useWorkspaceChatsDialog()
  const { open: speechToTextOpen, setOpen: setSpeechToTextOpen } =
    useSpeechToTextDialog()
  const { open: textToSpeechOpen, setOpen: setTextToSpeechOpen } =
    useTextToSpeechDialog()

  const handleCreateProject = async (
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ) => {
    const newProject = await addFolder(name, assistantId, logo, projectPrompt)
    setProjectDialogOpen(false)
    navigate({
      to: '/project/$projectId',
      params: { projectId: newProject.id },
    })
  }

  // Hub nav item (separate section matching Figma)
  const hubIconRef = useRef<BlocksIconHandle>(null)

  // Secondary nav items (features not in Figma but needed in app)
  const secondaryItems: NavItem[] = [
    {
      title: 'common:projects.new',
      animatedIcon: FolderPlusIcon,
      onClick: () => setProjectDialogOpen(true),
      shortcut: (
        <KbdGroup className="ml-auto scale-90 gap-0">
          <Kbd className="bg-transparent size-3">
            <PlatformMetaKey />
          </Kbd>
          <Kbd className="bg-transparent size-3">P</Kbd>
        </KbdGroup>
      ),
    },
    {
      title: 'common:projects.workspaceChats',
      icon: LayoutList,
      onClick: () => setWorkspaceChatsOpen(true),
    },
  ]

  return (
    <>
      {/* Primary Actions — matches Figma px-3 pb-3 space-y-1.5 */}
      <div className="space-y-1.5 pb-3 group-data-[collapsible=icon]:space-y-1 group-data-[collapsible=icon]:pb-0">
        {/* New Chat — gradient primary action */}
        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <Link
            to={route.home}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all text-white font-medium shadow-sm group-data-[collapsible=icon]:hidden"
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
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

      {/* Nav — Hub link (matches Figma: px-3 pb-2 standalone nav section) */}
      <div className="pb-2 group-data-[collapsible=icon]:pb-0 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
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
        </SidebarMenu>
      </div>

      {/* Secondary nav items (additional features not in Figma) */}
      <SidebarMenu>
        {secondaryItems.map((item) => {
          if (item.animatedIcon) {
            return (
              <NavItemWithAnimatedIcon
                key={item.title}
                item={item}
                label={t(item.title)}
              />
            )
          }

          const Icon = item.icon
          return (
            <SidebarMenuItem key={item.title} className="group-data-[collapsible=icon]:hidden">
              <SidebarMenuButton
                tooltip={t(item.title)}
                onClick={item.onClick}
              >
                {Icon && <Icon className="text-foreground/70 size-4" />}
                <span>{t(item.title)}</span>
                {item.shortcut}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>

      <AddProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        editingKey={null}
        onSave={handleCreateProject}
      />

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <WorkspaceChatsDialog
        open={workspaceChatsOpen}
        onOpenChange={setWorkspaceChatsOpen}
      />
      <SpeechToTextDialog
        open={speechToTextOpen}
        onOpenChange={setSpeechToTextOpen}
      />
      <TextToSpeechDialog
        open={textToSpeechOpen}
        onOpenChange={setTextToSpeechOpen}
      />
    </>
  )
}
