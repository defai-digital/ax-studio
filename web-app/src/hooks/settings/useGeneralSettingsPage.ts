import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useHardware } from '@/hooks/settings/useHardware'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useClipboardCopy } from '@/hooks/ui/useClipboardCopy'
import { SystemEvent } from '@/types/events'
import { isRootDir } from '@/lib/utils/path'
import { toast } from 'sonner'

const TOKEN_VALIDATION_TIMEOUT_MS = 10_000

export function useGeneralSettingsPage() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { pausePolling } = useHardware()
  const { huggingfaceToken } = useGeneralSetting()

  const [appDataFolder, setAppDataFolder] = useState<string | undefined>()
  const { isCopied, copyToClipboard } = useClipboardCopy()
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isValidatingToken, setIsValidatingToken] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const mountedRef = useRef(true)
  const tokenValidationAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      tokenValidationAbortRef.current?.abort()
      tokenValidationAbortRef.current = null
    }
  }, [])

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

  const validateHuggingFaceToken = async () => {
    const token = (huggingfaceToken || '').trim()
    if (!token) {
      toast.error('Please enter a Hugging Face token to validate')
      return
    }

    tokenValidationAbortRef.current?.abort()
    setIsValidatingToken(true)
    const controller = new AbortController()
    tokenValidationAbortRef.current = controller
    const timeoutId = setTimeout(
      () => controller.abort(),
      TOKEN_VALIDATION_TIMEOUT_MS
    )
    const isCurrentValidation = () =>
      mountedRef.current && tokenValidationAbortRef.current === controller

    try {
      const resp = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!isCurrentValidation()) return

      if (resp.ok) {
        const data = await resp.json()
        if (!isCurrentValidation()) return

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
      if (!isCurrentValidation()) return

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
      if (tokenValidationAbortRef.current === controller) {
        tokenValidationAbortRef.current = null
        if (mountedRef.current) {
          setIsValidatingToken(false)
        }
      }
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
    isValidatingToken,
    isResetting,
    openFileTitle,
    copyToClipboard,
    handleDataFolderChange,
    confirmDataFolderChange,
    resetApp,
    validateHuggingFaceToken,
  }
}
