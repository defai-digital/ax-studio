import { Minus, Square, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Button } from '@/components/ui/button'

export const WindowControls = () => {
  const appWindow = (() => {
    try {
      return getCurrentWebviewWindow()
    } catch {
      return null
    }
  })()

  const runWindowAction = async (
    action: (() => Promise<void>) | undefined,
    label: string
  ) => {
    try {
      await action?.()
    } catch (error) {
      console.error(`[WindowControls] Failed to ${label}:`, error)
    }
  }

  const handleMinimize = () => {
    void runWindowAction(() => appWindow?.minimize(), 'minimize window')
  }

  const handleMaximize = () => {
    void runWindowAction(() => appWindow?.toggleMaximize(), 'toggle maximize')
  }

  const handleClose = () => {
    void runWindowAction(() => appWindow?.close(), 'close window')
  }

  if (!appWindow) return null

  return (
    <div className="absolute top-0 z-50 right-4 h-15">
      <div className="flex items-center h-full">
        <Button
          onClick={handleMinimize}
          aria-label="Minimize"
          variant="ghost"
          size="icon-sm"
        >
          <Minus className="size-4" />
        </Button>
        <Button
          onClick={handleMaximize}
          variant="ghost"
          size="icon-sm"
          aria-label="Maximize"
        >
          <Square className="size-3" />
        </Button>
        <Button
          onClick={handleClose}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
