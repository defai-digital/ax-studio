import { useState, useEffect } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useHardware } from '@/hooks/settings/useHardware'
import { useClipboardCopy } from '@/hooks/ui/useClipboardCopy'
import { SystemEvent } from '@/types/events'
import { isRootDir } from '@/lib/utils/path'
import { toast } from 'sonner'

export function useGeneralSettingsPage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { pausePolling } = useHardware()
  const [appDataFolder, setAppDataFolder] = useState<string | undefined>()
  const { isCopied, copyToClipboard } = useClipboardCopy()
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchDataFolder = async () => {
      try {
        const path = await serviceHub.app().getAppDataFolder()
        if (!cancelled) {
          setAppDataFolder(path)
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to read app data folder:', error)
        toast.error(
          t('settings:general.failedToLoadDataFolder', {
            defaultValue: 'Failed to load app data folder',
          })
        )
      }
    }
    fetchDataFolder()

    return () => {
      cancelled = true
    }
  }, [serviceHub, t])

  const openFileTitle = (): string => {
    if (IS_MACOS) return t('settings:general.showInFinder')
    if (IS_WINDOWS) return t('settings:general.showInFileExplorer')
    return t('settings:general.openContainingFolder')
  }

  const handleDataFolderChange = async () => {
    let selectedPath: string | string[] | null = null
    try {
      selectedPath = await serviceHub.dialog().open({
        multiple: false,
        directory: true,
        defaultPath: appDataFolder,
      })
    } catch (error) {
      console.error('Failed to open data folder picker:', error)
      toast.error(t('settings:general.failedToRelocateDataFolderDesc'))
      return
    }
    if (selectedPath === appDataFolder) return
    if (selectedPath !== null) {
      setSelectedNewPath(selectedPath as string)
      setIsDialogOpen(true)
    }
  }

  const confirmDataFolderChange = async () => {
    if (!selectedNewPath) return
    try {
      await serviceHub.models().stopAllModels()
      serviceHub.events()?.emit(SystemEvent.KILL_SIDECAR)
      await new Promise((resolve) => setTimeout(resolve, 500))
      try {
        if (isRootDir(selectedNewPath))
          throw new Error(t('settings:general.couldNotRelocateToRoot'))
        await serviceHub.app().relocateAppDataFolder(selectedNewPath)
        setAppDataFolder(selectedNewPath)
        window.core?.api?.relaunch()
        setSelectedNewPath(null)
        setIsDialogOpen(false)
      } catch (error) {
        console.error(error)
        toast.error(
          error instanceof Error
            ? error.message
            : t('settings:general.failedToRelocateDataFolder')
        )
      }
    } catch (error) {
      console.error('Failed to relocate data folder:', error)
      const originalPath = await serviceHub.app().getAppDataFolder()
      setAppDataFolder(originalPath)
      toast.error(t('settings:general.failedToRelocateDataFolderDesc'))
    }
  }

  const resetApp = async () => {
    if (isRootDir(appDataFolder ?? '/')) {
      toast.error(t('settings:general.couldNotResetRootDirectory'))
      return
    }
    setIsResetting(true)
    pausePolling()
    try {
      await serviceHub.app().factoryReset()
    } catch (error) {
      console.error('Factory reset failed:', error)
      toast.error(
        t('settings:general.factoryResetFailed', {
          defaultValue: 'Factory reset failed',
        })
      )
    } finally {
      setIsResetting(false)
    }
  }

  const revealLogsFolder = async () => {
    if (!appDataFolder) return
    try {
      await serviceHub.opener().revealItemInDir(`${appDataFolder}/logs`)
    } catch (error) {
      console.error('Failed to reveal logs folder:', error)
    }
  }

  return {
    appDataFolder,
    revealLogsFolder,
    isCopied,
    selectedNewPath,
    isDialogOpen,
    setIsDialogOpen,
    setSelectedNewPath,
    isResetting,
    openFileTitle,
    copyToClipboard,
    handleDataFolderChange,
    confirmDataFolderChange,
    resetApp,
  }
}
