import { PanelLeft } from "lucide-react";
import { useLeftPanel } from '@/hooks/ui/useLeftPanel'
import { cn } from '@/lib/utils'
import { ReactNode, memo, useCallback, type MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

type HeaderPageProps = {
  children?: ReactNode
}

const WINDOW_DRAG_IGNORE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="link"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[data-window-drag-ignore]',
].join(',')

function canStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  return !target.closest(WINDOW_DRAG_IGNORE_SELECTOR)
}

const HeaderPage = memo(function HeaderPage({ children }: HeaderPageProps) {
  const { open, setLeftPanel } = useLeftPanel()
  const handleWindowDrag = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!IS_TAURI || event.button !== 0 || !canStartWindowDrag(event.target)) {
      return
    }

    try {
      void getCurrentWebviewWindow().startDragging()
    } catch (error) {
      console.error('[HeaderPage] Failed to start window drag:', error)
    }
  }, [])

  return (
    <div
      className={cn(
        'h-15 flex items-center shrink-0 relative z-30',
        (IS_MACOS && !open) ? 'pl-5' : 'pl-4',
        children === undefined && 'border-none'
      )}
      onMouseDown={handleWindowDrag}
    >
      <div
        className={cn(
          'flex items-center w-full gap-2',
        )}
      >
        {!open && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full relative z-50"
            onClick={() => setLeftPanel(!open)}
            aria-label="Toggle sidebar"
          >
            <PanelLeft
              className="text-muted-foreground relative size-4.5"
            />
          </Button>
        )}
        <div
          className={cn(
            'flex-1 min-w-0'
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
})

export default HeaderPage
