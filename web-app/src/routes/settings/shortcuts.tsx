import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  ShortcutAction,
  PlatformShortcuts,
  type ShortcutSpec,
} from '@/lib/shortcuts'
import { PlatformMetaKey } from '@/components/common/PlatformMetaKey'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import HeaderPage from '@/containers/HeaderPage'
import { Keyboard as KeyboardIcon } from 'lucide-react'

export const Route = createFileRoute(route.settings.shortcuts)({
  component: Shortcuts,
})

interface ShortcutLabelProps {
  action: ShortcutAction
  className?: string
}

/**
 * Renders a keyboard shortcut label consistently across platforms
 */
function ShortcutLabel({ action, className = '' }: ShortcutLabelProps) {
  const spec = PlatformShortcuts[action]

  return (
    <KbdGroup className={className}>
      <ShortcutKeys spec={spec} />
    </KbdGroup>
  )
}

/**
 * Renders the key combination for a shortcut spec
 */
function ShortcutKeys({ spec }: { spec: ShortcutSpec }) {
  const parts: React.ReactNode[] = []

  // Helper function to format key names consistently
  const formatKey = (key: string) => {
    const lowerKey = key.toLowerCase()
    if (lowerKey === 'enter') return 'Enter'
    if (lowerKey === 'shift') return 'Shift'
    if (lowerKey === 'ctrl') return 'Ctrl'
    if (lowerKey === 'alt') return 'Alt'
    return key.toUpperCase()
  }

  // Add modifier keys
  if (spec.usePlatformMetaKey) {
    parts.push(
      <Kbd key="meta">
        <PlatformMetaKey />
      </Kbd>
    )
  }
  if (spec.ctrlKey) {
    parts.push(<Kbd key="ctrl">Ctrl</Kbd>)
  }
  if (spec.metaKey) {
    parts.push(<Kbd key="cmd">⌘</Kbd>)
  }
  if (spec.altKey) {
    parts.push(<Kbd key="alt">Alt</Kbd>)
  }
  if (spec.shiftKey) {
    parts.push(<Kbd key="shift">Shift</Kbd>)
  }

  // Add the main key with proper formatting
  parts.push(<Kbd key="main">{formatKey(spec.key)}</Kbd>)

  return <>{parts}</>
}

function Shortcuts() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div
              className="size-7 rounded-lg flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              }}
            >
              <KeyboardIcon className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              {t('common:keyboardShortcuts')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* Application */}
              <Card title={t('settings:shortcuts.application')}>
                <CardItem
                  title={t('settings:shortcuts.newChat')}
                  description={t('settings:shortcuts.newChatDesc')}
                  actions={<ShortcutLabel action={ShortcutAction.NEW_CHAT} />}
                />
                <CardItem
                  title={t('settings:shortcuts.newProject')}
                  description={t('settings:shortcuts.newProjectDesc')}
                  actions={
                    <ShortcutLabel action={ShortcutAction.NEW_PROJECT} />
                  }
                />
                <CardItem
                  title={t('settings:shortcuts.toggleSidebar')}
                  description={t('settings:shortcuts.toggleSidebarDesc')}
                  actions={
                    <ShortcutLabel action={ShortcutAction.TOGGLE_SIDEBAR} />
                  }
                />
                <CardItem
                  title={t('settings:shortcuts.zoomIn')}
                  description={t('settings:shortcuts.zoomInDesc')}
                  actions={<ShortcutLabel action={ShortcutAction.ZOOM_IN} />}
                />
                <CardItem
                  title={t('settings:shortcuts.zoomOut')}
                  description={t('settings:shortcuts.zoomOutDesc')}
                  actions={<ShortcutLabel action={ShortcutAction.ZOOM_OUT} />}
                />
              </Card>

              {/* Chat */}
              <Card title={t('settings:shortcuts.chat')}>
                <CardItem
                  title={t('settings:shortcuts.sendMessage')}
                  description={t('settings:shortcuts.sendMessageDesc')}
                  actions={
                    <KbdGroup>
                      <Kbd>Enter</Kbd>
                    </KbdGroup>
                  }
                />
                <CardItem
                  title={t('settings:shortcuts.newLine')}
                  description={t('settings:shortcuts.newLineDesc')}
                  actions={
                    <KbdGroup>
                      <Kbd>Shift</Kbd>
                      <Kbd>Enter</Kbd>
                    </KbdGroup>
                  }
                />
              </Card>

              {/* Navigation */}
              <Card title={t('settings:shortcuts.navigation')}>
                <CardItem
                  title={t('settings:shortcuts.search')}
                  description={t('settings:shortcuts.searchDesc')}
                  actions={<ShortcutLabel action={ShortcutAction.SEARCH} />}
                />
                <CardItem
                  title={t('settings:shortcuts.goToSettings')}
                  description={t('settings:shortcuts.goToSettingsDesc')}
                  actions={
                    <ShortcutLabel action={ShortcutAction.GO_TO_SETTINGS} />
                  }
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
