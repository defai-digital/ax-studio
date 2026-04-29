import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useAppUpdater } from '@/hooks/updater/useAppUpdater'
import { useHardware } from '@/hooks/settings/useHardware'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { SystemEvent } from '@/types/events'
import { isRootDir } from '@/lib/utils/path'
import { isDev } from '@/lib/utils'
import { toast } from 'sonner'

const TOKEN_VALIDATION_TIMEOUT_MS = 10_000

export function useGeneralSettingsPage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { checkForUpdate } = useAppUpdater()
  const { pausePolling } = useHardware()
  const { huggingfaceToken } = useGeneralSetting()

  const [appDataFolder, setAppDataFolder] = useState<string | undefined>()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isValidatingToken, setIsValidatingToken] = useState(false)
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    const fetchDataFolder = async () => {
      try {
        const path = await serviceHub.app().getAppDataFolder()
        setAppDataFolder(path)
      } catch (error) {
        console.error('Failed to read app data folder:', error)
        toast.error(
          t('settings:general.failedToLoadDataFolder', {
            defaultValue: 'Failed to load app data folder',
          })
        )
      }
    }
    fetchDataFolder()
  }, [serviceHub, t])

  const openFileTitle = (): string => {
    if (IS_MACOS) return t('settings:general.showInFinder')
    if (IS_WINDOWS) return t('settings:general.showInFileExplorer')
    return t('settings:general.openContainingFolder')
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
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
      serviceHub.events().emit(SystemEvent.KILL_SIDECAR)
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

  const handleCheckForUpdate = useCallback(async () => {
    setIsCheckingUpdate(true)
    try {
      if (isDev()) return toast.info(t('settings:general.devVersion'))
      const update = await checkForUpdate(true)
      if (!update) toast.info(t('settings:general.noUpdateAvailable'))
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error(t('settings:general.updateError'))
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [t, checkForUpdate])

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

  const validateHuggingFaceToken = async () => {
    const token = (huggingfaceToken || '').trim()
    if (!token) {
      toast.error('Please enter a Hugging Face token to validate')
      return
    }
    setIsValidatingToken(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TOKEN_VALIDATION_TIMEOUT_MS)
    try {
      const resp = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (resp.ok) {
        const data = await resp.json()
        toast.success('Token is valid', {
          description: data?.name
            ? `Signed in as ${data.name}`
            : 'Your Hugging Face token is valid.',
        })
      } else {
        toast.error('Token invalid', {
          description:
            'The provided Hugging Face token is invalid. Please check your token and try again.',
        })
      }
    } catch (e) {
      const name = (e as { name?: string })?.name
      if (name === 'AbortError') {
        toast.error('Validation timed out', {
          description:
            'The validation request timed out. Please check your network connection and try again.',
        })
      } else {
        toast.error('Validation failed', {
          description:
            'A network error occurred while validating the token. Please check your internet connection.',
        })
      }
    } finally {
      clearTimeout(timeoutId)
      setIsValidatingToken(false)
    }
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLogsWindow()
    } catch (error) {
      console.error('Failed to open logs window:', error)
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
    isCheckingUpdate,
    isValidatingToken,
    isResetting,
    openFileTitle,
    copyToClipboard,
    handleDataFolderChange,
    confirmDataFolderChange,
    handleCheckForUpdate,
    resetApp,
    validateHuggingFaceToken,
    handleOpenLogs,
  }
}
