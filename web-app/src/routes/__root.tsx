import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { Fragment } from 'react/jsx-runtime'
import { useEffect, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { ElectronUpdateBanner } from '@/containers/ElectronUpdateBanner'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { InterfaceProvider } from '@/providers/InterfaceProvider'
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'
import { DataProvider } from '@/providers/DataProvider'
import { ExtensionProvider } from '@/providers/ExtensionProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'
import { useLeftPanel } from '@/hooks/ui/useLeftPanel'
import { TranslationProvider } from '@/i18n/TranslationContext'
import { OutOfContextPromiseModal } from '@/containers/dialogs/OutOfContextDialog'
import { GlobalError } from '@/components/common/GlobalError'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LeftSidebar } from '@/components/left-sidebar'
import {
  pageVariants,
  pageTransition,
  reducedMotionTransition,
  reducedMotionVariants,
} from '@/lib/utils/animations'
import { hideInitialLoader } from '@/lib/bootstrap/app-startup'
import { HuggingFaceConnectionProvider } from '@/providers/HuggingFaceConnectionProvider'
import { HuggingFaceConnectionDialog } from '@/containers/HuggingFaceConnectionDialog'

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalError error={error} />,
})

const PageTransition = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation()
  const prefersReducedMotion = useReducedMotion()
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
      variants={prefersReducedMotion ? reducedMotionVariants : pageVariants}
      transition={
        prefersReducedMotion ? reducedMotionTransition : pageTransition
      }
      className="size-full"
    >
      {children}
    </motion.div>
  )
}

// Native window frame (Electron `frame: true`) — no custom drag chrome.
const MacWindowChrome = ({ children }: { children: ReactNode }) => {
  return (
    <div className="bg-background size-full relative overflow-hidden">
      {children}
    </div>
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
    <MacWindowChrome>
      <SidebarProvider
        open={isLeftPanelOpen}
        onOpenChange={setLeftPanel}
        defaultWidth={sidebarWidth}
        onWidthChange={setLeftPanelWidth}
      >
        <KeyboardShortcutsProvider />
        <ElectronUpdateBanner />
        <LeftSidebar />
        <SidebarInset>
          <div className="bg-background w-full flex-1 min-h-0 overflow-hidden">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </MacWindowChrome>
  )
}

function RootLayout() {
  useEffect(() => {
    const hideLoader = () => {
      requestAnimationFrame(() => {
        hideInitialLoader()
      })
    }

    const timer = setTimeout(hideLoader, 200)

    return () => clearTimeout(timer)
  }, [])

  return (
    <Fragment>
      <ErrorBoundary name="root">
        <ServiceHubProvider>
          <ThemeProvider />
          <InterfaceProvider />
          <ToasterProvider />
          <TranslationProvider>
            <ErrorBoundary name="extensions">
              <ExtensionProvider>
                <DataProvider />
                <GlobalEventHandler />
                <HuggingFaceConnectionProvider />
                <HuggingFaceConnectionDialog />
                <ErrorBoundary name="app-shell">
                  <AppLayout />
                </ErrorBoundary>
              </ExtensionProvider>
            </ErrorBoundary>
            <OutOfContextPromiseModal />
          </TranslationProvider>
        </ServiceHubProvider>
      </ErrorBoundary>
    </Fragment>
  )
}
