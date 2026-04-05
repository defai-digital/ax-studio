import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import DialogAppUpdater from '@/containers/dialogs/AppUpdater'
import { Fragment } from 'react/jsx-runtime'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { InterfaceProvider } from '@/providers/InterfaceProvider'
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'
import { DataProvider } from '@/providers/DataProvider'
import { route } from '@/constants/routes'
import { ExtensionProvider } from '@/providers/ExtensionProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'
import { useLeftPanel } from '@/hooks/ui/useLeftPanel'
import ToolApproval from '@/containers/dialogs/ToolApproval'
import AttachmentIngestionDialog from '@/containers/dialogs/AttachmentIngestionDialog'
import { TranslationProvider } from '@/i18n/TranslationContext'
import OutOfContextPromiseModal from '@/containers/dialogs/OutOfContextDialog'
import { useEffect } from 'react'
import GlobalError from '@/components/common/GlobalError'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LeftSidebar } from '@/components/left-sidebar'
import { WindowControls } from '@/components/WindowControls'
import { motion } from 'motion/react'
import { pageVariants, pageTransition } from '@/lib/animations'
import { hideInitialLoader } from '@/lib/bootstrap/app-startup'

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalError error={error} />,
})

const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation()
  // Group all /settings/* routes under one key so the sidebar doesn't
  // unmount/remount (flicker) when switching between settings tabs.
  const animationKey = location.pathname.startsWith('/settings')
    ? '/settings'
    : location.pathname
  return (
    <motion.div
      key={animationKey}
      initial="initial"
      animate="animate"
      variants={pageVariants}
      transition={pageTransition}
      className="size-full"
    >
      {children}
    </motion.div>
  )
}

const AppLayout = () => {
  const {
    open: isLeftPanelOpen,
    setLeftPanel,
    width: sidebarWidth,
    setLeftPanelWidth,
  } = useLeftPanel()

  return (
    <div className="bg-background size-full relative overflow-hidden">
      <SidebarProvider
        open={isLeftPanelOpen}
        onOpenChange={setLeftPanel}
        defaultWidth={sidebarWidth}
        onWidthChange={setLeftPanelWidth}
      >
        <KeyboardShortcutsProvider />
        {/* Fake absolute panel top to enable window drag */}
        {!IS_MACOS && <WindowControls />}
        <div className="fixed w-full h-12 z-20 top-0" data-tauri-drag-region />
        <DialogAppUpdater />
        <LeftSidebar />
        <SidebarInset>
          <div className="bg-background w-full flex-1 min-h-0 overflow-hidden">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

const LogsLayout = () => {
  return (
    <Fragment>
      <main className="relative h-svh text-sm antialiased select-text bg-app">
        <div className="flex h-full">
          {/* Main content panel */}
          <div className="h-full flex w-full">
            <div className="bg-background text-foreground border w-full overflow-hidden">
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </Fragment>
  )
}

function RootLayout() {
  const location = useLocation()

  useEffect(() => {
    const hideLoader = () => {
      requestAnimationFrame(() => {
        hideInitialLoader()
      })
    }

    const timer = setTimeout(hideLoader, 200)

    return () => clearTimeout(timer)
  }, [])

  const isLogsRoute =
    location.pathname === route.localApiServerlogs ||
    location.pathname === route.systemMonitor ||
    location.pathname === route.appLogs

  return (
    <Fragment>
      <ServiceHubProvider>
        <ThemeProvider />
        <InterfaceProvider />
        <ToasterProvider />
        <TranslationProvider>
          <ExtensionProvider>
            <DataProvider />
            <GlobalEventHandler />
            {isLogsRoute ? <LogsLayout /> : <AppLayout />}
          </ExtensionProvider>
          {/* <TanStackRouterDevtools position="bottom-right" /> */}
          <ToolApproval />
          <AttachmentIngestionDialog />
          <OutOfContextPromiseModal />
        </TranslationProvider>
      </ServiceHubProvider>
    </Fragment>
  )
}
