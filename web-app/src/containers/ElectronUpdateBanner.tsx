// Minimal electron-updater banner (Phase 4), mounted in routes/__root.tsx.
//
// States: hidden while checking / up-to-date; "Update Now" when an update is
// available; progress while downloading; "Restart to Update" once downloaded.
// Everything flows through the updater IPC commands and the main→renderer
// `updater-event` channel (electron/src/updater.ts). In dev and smoke mode
// `updater_check` returns `{ enabled: false }` and the banner stays hidden;
// the effect also short-circuits before any IPC in smoke mode.
import { useEffect, useState } from 'react'
import { invoke } from '@/lib/tauri-shim/api-core'
import { listen } from '@/lib/tauri-shim/api-event'
import { Download, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { isElectronSmokeMode, isPlatformElectron } from '@/lib/platform/utils'

export const UPDATER_EVENT = 'updater-event'

type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface UpdaterStatus {
  enabled: boolean
  reason?: 'dev' | 'smoke'
  state: UpdaterState
  version?: string
  percent?: number
  message?: string
}

export function ElectronUpdateBanner() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isPlatformElectron() || isElectronSmokeMode()) return
    let disposed = false
    let unlisten: (() => void) | undefined

    invoke<UpdaterStatus>('updater_check')
      .then((result) => {
        if (!disposed) setStatus(result)
      })
      .catch(() => {
        // Banner stays hidden; main also reports errors over the event channel.
      })
    void listen<UpdaterStatus>(UPDATER_EVENT, (event) => {
      if (!disposed) setStatus(event.payload)
    }).then((off) => {
      unlisten = off
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  if (!status?.enabled || dismissed) return null

  if (status.state === 'available') {
    return (
      <div className="fixed z-50 bottom-3 right-3 bg-background flex items-center border rounded-lg shadow-md px-4 py-3 gap-3">
        <Download size={20} className="shrink-0 text-muted-foreground" />
        <div className="text-base font-medium">
          {t('updater:newVersion', { version: status.version })}
        </div>
        <div className="flex gap-x-2">
          <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
            {t('updater:remindMeLater')}
          </Button>
          <Button size="sm" onClick={() => void invoke('updater_download')}>
            {t('updater:updateNow')}
          </Button>
        </div>
      </div>
    )
  }

  if (status.state === 'downloading') {
    return (
      <div className="fixed z-50 bottom-3 right-3 bg-background flex items-center border rounded-lg shadow-md px-4 py-3 gap-3">
        <Download size={20} className="shrink-0 text-muted-foreground animate-pulse" />
        <div className="text-base font-medium">
          {t('updater:downloading')}
          {typeof status.percent === 'number' ? ` ${status.percent}%` : ''}
        </div>
      </div>
    )
  }

  if (status.state === 'downloaded') {
    return (
      <div className="fixed z-50 bottom-3 right-3 bg-background flex items-center border rounded-lg shadow-md px-4 py-3 gap-3">
        <RefreshCw size={20} className="shrink-0 text-muted-foreground" />
        <div className="text-base font-medium">
          {t('updater:newVersion', { version: status.version })}
        </div>
        <Button size="sm" onClick={() => void invoke('updater_install')}>
          {t('updater:restartToUpdate')}
        </Button>
      </div>
    )
  }

  return null
}
