import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useAppUpdater } from '@/hooks/updater/useAppUpdater'
import { useEffect, useState, useCallback } from 'react'
import ChangeDataFolderLocation from '@/containers/dialogs/thread/ChangeDataFolderLocation'
import { FactoryResetDialog } from '@/containers/dialogs'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  IconBrandDiscord,
  IconBrandGithub,
  IconExternalLink,
  IconFolder,
  IconLogs,
  IconCopy,
  IconCopyCheck,
} from '@tabler/icons-react'
import { Settings } from 'lucide-react'
import { toast } from 'sonner'
import { isDev } from '@/lib/utils'
import { SystemEvent } from '@/types/events'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useHardware } from '@/hooks/settings/useHardware'
import LanguageSwitcher from '@/containers/LanguageSwitcher'
import { isRootDir } from '@/lib/utils/path'
import { fallbackDefaultPrompt } from '@/lib/system-prompt'
const TOKEN_VALIDATION_TIMEOUT_MS = 10_000

export const Route = createFileRoute(route.settings.general)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  const {
    spellCheckChatInput,
    setSpellCheckChatInput,
    huggingfaceToken,
    setHuggingfaceToken,
    globalDefaultPrompt,
    setGlobalDefaultPrompt,
    autoTuningEnabled,
    setAutoTuningEnabled,
    applyMode,
    setApplyMode,
  } = useGeneralSetting()
  const safeGlobalDefaultPrompt = globalDefaultPrompt ?? ''
  const serviceHub = useServiceHub()

  const openFileTitle = (): string => {
    if (IS_MACOS) {
      return t('settings:general.showInFinder')
    } else if (IS_WINDOWS) {
      return t('settings:general.showInFileExplorer')
    } else {
      return t('settings:general.openContainingFolder')
    }
  }
  const { checkForUpdate } = useAppUpdater()
  const { pausePolling } = useHardware()
  const [appDataFolder, setAppDataFolder] = useState<string | undefined>()
  const [isCopied, setIsCopied] = useState(false)
  const [selectedNewPath, setSelectedNewPath] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isValidatingToken, setIsValidatingToken] = useState(false)

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

  const [isResetting, setIsResetting] = useState(false)

  const resetApp = async () => {
    // Prevent resetting if data folder is root directory
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
      toast.error(t('settings:general.factoryResetFailed', { defaultValue: 'Factory reset failed' }))
    } finally {
      setIsResetting(false)
    }
  }

  const handleOpenLogs = async () => {
    try {
      await serviceHub.window().openLogsWindow()
    } catch (error) {
      console.error('Failed to open logs window:', error)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000) // Reset after 2 seconds
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
    if (selectedNewPath) {
      try {
        await serviceHub.models().stopAllModels()
        serviceHub.events().emit(SystemEvent.KILL_SIDECAR)
        setTimeout(async () => {
          try {
            // Prevent relocating to root directory (e.g., C:\ or D:\ on Windows, / on Unix)
            if (isRootDir(selectedNewPath))
              throw new Error(t('settings:general.couldNotRelocateToRoot'))
            await serviceHub.app().relocateAppDataFolder(selectedNewPath)
            setAppDataFolder(selectedNewPath)
            // Only relaunch if relocation was successful
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
        }, 1000)
      } catch (error) {
        console.error('Failed to relocate data folder:', error)
        // Revert the data folder path on error
        const originalPath = await serviceHub.app().getAppDataFolder()
        setAppDataFolder(originalPath)

        toast.error(t('settings:general.failedToRelocateDataFolderDesc'))
      }
    }
  }

  const handleCheckForUpdate = useCallback(async () => {
    setIsCheckingUpdate(true)
    try {
      if (isDev()) return toast.info(t('settings:general.devVersion'))
      const update = await checkForUpdate(true)
      if (!update) {
        toast.info(t('settings:general.noUpdateAvailable'))
      }
      // If update is available, the AppUpdater dialog will automatically show
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error(t('settings:general.updateError'))
    } finally {
      setIsCheckingUpdate(false)
    }
  }, [t, checkForUpdate])

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
              <Settings className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              {t('common:general')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* General */}
              <Card title={t('common:general')}>
                <CardItem
                  title={t('settings:general.appVersion')}
                  actions={
                    <span className="text-foreground font-medium">
                      v{VERSION}
                    </span>
                  }
                />
                {!AUTO_UPDATER_DISABLED && (
                  <CardItem
                    title={t('settings:general.checkForUpdates')}
                    description={t('settings:general.checkForUpdatesDesc')}
                    className="items-center flex-row gap-y-2"
                    actions={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCheckForUpdate}
                        disabled={isCheckingUpdate}
                      >
                        {isCheckingUpdate
                          ? t('settings:general.checkingForUpdates')
                          : t('settings:general.checkForUpdates')}
                      </Button>
                    }
                  />
                )}
                <CardItem
                  title={t('common:language')}
                  actions={<LanguageSwitcher />}
                />
              </Card>

              <Card title="Custom System Prompts">
                <CardItem
                  title="Global Default Prompt"
                  description="Used when thread/project overrides are empty."
                  align="start"
                  actions={
                    <div className="w-full max-w-xl space-y-2">
                      <Textarea
                        value={safeGlobalDefaultPrompt}
                        onChange={(event) =>
                          setGlobalDefaultPrompt(event.target.value)
                        }
                        className="min-h-28"
                        placeholder={fallbackDefaultPrompt}
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{safeGlobalDefaultPrompt.length} characters</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setGlobalDefaultPrompt('')}
                        >
                          Reset to Default
                        </Button>
                      </div>
                    </div>
                  }
                />
                <CardItem
                  title="Auto Tuning"
                  description="Automatically tune temperature, top_p and max tokens without changing prompt."
                  actions={
                    <Switch
                      checked={autoTuningEnabled}
                      onCheckedChange={(value) => setAutoTuningEnabled(value)}
                    />
                  }
                />
                <CardItem
                  title="Apply Mode"
                  description="Choose whether global prompt updates affect all chats or only new chats."
                  actions={
                    <select
                      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
                      value={applyMode}
                      onChange={(event) =>
                        setApplyMode(
                          event.target.value as 'new_chats_only' | 'all_chats'
                        )
                      }
                    >
                      <option value="all_chats">All chats</option>
                      <option value="new_chats_only">New chats only</option>
                    </select>
                  }
                />
              </Card>

              {/* Data folder - Desktop only */}
              <Card title={t('common:dataFolder')}>
                <CardItem
                  title={t('settings:dataFolder.appData', {
                    ns: 'settings',
                  })}
                  align="start"
                  className="items-start flex-row gap-2"
                  description={
                    <>
                      <span>
                        {t('settings:dataFolder.appDataDesc', {
                          ns: 'settings',
                        })}
                        &nbsp;
                      </span>
                      <div className="flex items-center gap-2 mt-1 ">
                        <div className="truncate">
                          <span
                            title={appDataFolder}
                            className="bg-secondary text-xs p-1 rounded-sm"
                          >
                            {appDataFolder}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            appDataFolder && copyToClipboard(appDataFolder)
                          }
                          className="cursor-pointer flex items-center justify-center rounded-sm bg-secondary transition-all duration-200 ease-in-out p-1"
                          title={
                            isCopied
                              ? t('settings:general.copied')
                              : t('settings:general.copyPath')
                          }
                        >
                          {isCopied ? (
                            <div className="flex items-center gap-1">
                              <IconCopyCheck
                                size={14}
                                className="text-green-500 dark:text-green-600"
                              />
                              <span className="text-xs leading-0">
                                {t('settings:general.copied')}
                              </span>
                            </div>
                          ) : (
                            <IconCopy
                              size={14}
                              className="text-muted-foreground"
                            />
                          )}
                        </button>
                      </div>
                    </>
                  }
                  actions={
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        title={t('settings:dataFolder.appData')}
                        onClick={handleDataFolderChange}
                      >
                        <IconFolder
                          size={12}
                          className="text-muted-foreground"
                        />
                        <span>{t('settings:general.changeLocation')}</span>
                      </Button>
                      {selectedNewPath && (
                        <ChangeDataFolderLocation
                          currentPath={appDataFolder || ''}
                          newPath={selectedNewPath}
                          onConfirm={confirmDataFolderChange}
                          open={isDialogOpen}
                          onOpenChange={(open) => {
                            setIsDialogOpen(open)
                            if (!open) {
                              setSelectedNewPath(null)
                            }
                          }}
                        >
                          <div />
                        </ChangeDataFolderLocation>
                      )}
                    </>
                  }
                />
                <CardItem
                  title={t('settings:dataFolder.appLogs', {
                    ns: 'settings',
                  })}
                  description={t('settings:dataFolder.appLogsDesc')}
                  className="items-start flex-row gap-y-2"
                  actions={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="p-0"
                        onClick={async () => {
                          if (appDataFolder) {
                            try {
                              const logsPath = `${appDataFolder}/logs`
                              await serviceHub
                                .opener()
                                .revealItemInDir(logsPath)
                            } catch (error) {
                              console.error(
                                'Failed to reveal logs folder:',
                                error
                              )
                            }
                          }
                        }}
                        title={t('settings:general.revealLogs')}
                      >
                        <IconFolder
                          size={12}
                          className="text-muted-foreground"
                        />
                        <span>{openFileTitle()}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenLogs}
                        title={t('settings:dataFolder.appLogs')}
                      >
                        <IconLogs size={12} className="text-muted-foreground" />
                        <span>{t('settings:general.openLogs')}</span>
                      </Button>
                    </div>
                  }
                />
              </Card>

              {/* Advanced - Desktop only */}
              <Card title="Advanced">
                <CardItem
                  title={t('settings:others.resetFactory', {
                    ns: 'settings',
                  })}
                  description={t('settings:others.resetFactoryDesc', {
                    ns: 'settings',
                  })}
                  actions={
                    <FactoryResetDialog onReset={resetApp}>
                      <Button variant="destructive" size="sm" disabled={isResetting}>
                        {isResetting ? t('common:resetting', { defaultValue: 'Resetting...' }) : t('common:reset')}
                      </Button>
                    </FactoryResetDialog>
                  }
                />
              </Card>

              {/* Other */}
              <Card title={t('common:others')}>
                <CardItem
                  title={t('settings:others.spellCheck', {
                    ns: 'settings',
                  })}
                  description={t('settings:others.spellCheckDesc', {
                    ns: 'settings',
                  })}
                  actions={
                    <Switch
                      checked={spellCheckChatInput}
                      onCheckedChange={(e) => setSpellCheckChatInput(e)}
                    />
                  }
                />
                <CardItem
                  title={t('settings:general.huggingfaceToken', {
                    ns: 'settings',
                  })}
                  description={t('settings:general.huggingfaceTokenDesc', {
                    ns: 'settings',
                  })}
                  actions={
                    <div className="flex items-center gap-2">
                      <Input
                        id="hf-token"
                        value={huggingfaceToken || ''}
                        onChange={(e) => setHuggingfaceToken(e.target.value)}
                        placeholder={'hf_xxx_xxx'}
                        required
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isValidatingToken}
                        onClick={async () => {
                          const token = (huggingfaceToken || '').trim()
                          if (!token) {
                            toast.error(
                              'Please enter a Hugging Face token to validate'
                            )
                            return
                          }
                          setIsValidatingToken(true)
                          const controller = new AbortController()
                          const timeoutId = setTimeout(
                            () => controller.abort(),
                            TOKEN_VALIDATION_TIMEOUT_MS
                          )
                          try {
                            const resp = await fetch(
                              'https://huggingface.co/api/whoami-v2',
                              {
                                headers: { Authorization: `Bearer ${token}` },
                                signal: controller.signal,
                              }
                            )
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
                        }}
                      >
                        Verify
                      </Button>
                    </div>
                  }
                />
              </Card>

              {/* Resources */}
              <Card title={t('settings:general.resources')}>
                <CardItem
                  title={t('settings:general.documentation')}
                  description={t('settings:general.documentationDesc')}
                  actions={
                    <a
                      href="https://axstudio.ai/docs"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('settings:general.viewDocs')}</span>
                        <IconExternalLink size={14} />
                      </div>
                    </a>
                  }
                />
                <CardItem
                  title={t('settings:general.releaseNotes')}
                  description={t('settings:general.releaseNotesDesc')}
                  actions={
                    <a
                      href="https://github.com/ax-studio/ax-studio/releases"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('settings:general.viewReleases')}</span>
                        <IconExternalLink size={14} />
                      </div>
                    </a>
                  }
                />
              </Card>

              {/* Community */}
              <Card title={t('settings:general.community')}>
                <CardItem
                  title={t('settings:general.github')}
                  description={t('settings:general.githubDesc')}
                  actions={
                    <a
                      href="https://github.com/ax-studio/ax-studio"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconBrandGithub
                        size={18}
                        className="text-muted-foreground"
                      />
                    </a>
                  }
                />
                <CardItem
                  title={t('settings:general.discord')}
                  description={t('settings:general.discordDesc')}
                  actions={
                    <a
                      href="https://discord.gg/cd5AD5zY6U"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconBrandDiscord
                        size={18}
                        className="text-muted-foreground"
                      />
                    </a>
                  }
                />
              </Card>

              {/* Support */}
              <Card title={t('settings:general.support')}>
                <CardItem
                  title={t('settings:general.reportAnIssue')}
                  description={t('settings:general.reportAnIssueDesc')}
                  actions={
                    <a
                      href="https://github.com/ax-studio/ax-studio/issues/new"
                      target="_blank"
                    >
                      <div className="flex items-center gap-1">
                        <span>{t('settings:general.reportIssue')}</span>
                        <IconExternalLink size={14} />
                      </div>
                    </a>
                  }
                />
              </Card>

              {/* Credits */}
              <Card title={t('settings:general.credits')}>
                <CardItem
                  align="start"
                  description={
                    <div className="text-muted-foreground -mt-2">
                      <p>{t('settings:general.creditsDesc1')}</p>
                      <p className="mt-2">
                        {t('settings:general.creditsDesc2')}
                      </p>
                    </div>
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
