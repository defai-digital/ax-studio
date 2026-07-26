import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { SettingsMenu } from '@/components/common/SettingsMenu'
import { HeaderPage } from '@/containers/HeaderPage'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Card, CardItem } from '@/components/common/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { ChangeDataFolderLocation } from '@/containers/dialogs/thread/ChangeDataFolderLocation'
import { FactoryResetDialog } from '@/containers/dialogs'
import {
  CheckCheck,
  Copy,
  ExternalLink,
  Folder,
  Github,
  MessageCircle,
  Settings,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fallbackDefaultPrompt } from '@/lib/prompts/system-prompt'
import { useGeneralSettingsPage } from '@/hooks/settings/useGeneralSettingsPage'
import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout'
import { InterfaceSettingsSection } from '@/components/settings/InterfaceSettingsSection'
import { PrivacySettingsSection } from '@/components/settings/PrivacySettingsSection'
import { AX_STUDIO_EXTERNAL_LINKS } from '@/constants/external-links'

function ExternalTextLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <ExternalLink size={14} />
      </div>
    </a>
  )
}

export const Route = createFileRoute(route.settings.general)({
  component: General,
})

function General() {
  const { t } = useTranslation()
  // Electron prunes the settings surface to General/Providers (matrix §1);
  // interface + privacy merge into this page.
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

  const {
    appDataFolder,
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
    revealLogsFolder,
  } = useGeneralSettingsPage()

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
          style={{ scrollbarWidth: 'thin' }}
        >
          <SettingsPageLayout icon={Settings} title={t('common:general')} />
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
              </Card>

              {/* Interface + Privacy merged into General (matrix §1) */}
              <InterfaceSettingsSection />
              <PrivacySettingsSection />

              <Card title="Custom System Prompts">
                <div className="border-b border-border/40 px-5 py-4">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label
                        htmlFor="global-default-prompt"
                        className="block font-medium text-foreground"
                        style={{ fontSize: '13px' }}
                      >
                        Global Default Prompt
                      </label>
                      <p
                        id="global-default-prompt-description"
                        className="text-muted-foreground leading-relaxed"
                        style={{ fontSize: '12px' }}
                      >
                        Used when thread/project overrides are empty.
                      </p>
                    </div>
                    <Textarea
                      id="global-default-prompt"
                      aria-describedby="global-default-prompt-description"
                      value={safeGlobalDefaultPrompt}
                      onChange={(event) =>
                        setGlobalDefaultPrompt(event.target.value)
                      }
                      className="min-h-40 resize-y leading-relaxed"
                      placeholder={fallbackDefaultPrompt}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{safeGlobalDefaultPrompt.length} characters</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setGlobalDefaultPrompt('')}
                      >
                        Reset to Default
                      </Button>
                    </div>
                  </div>
                </div>
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
                  title={t('settings:dataFolder.appData', { ns: 'settings' })}
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
                              <CheckCheck
                                size={14}
                                className="text-green-500 dark:text-green-600"
                              />
                              <span className="text-xs leading-0">
                                {t('settings:general.copied')}
                              </span>
                            </div>
                          ) : (
                            <Copy size={14} className="text-muted-foreground" />
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
                        <Folder size={12} className="text-muted-foreground" />
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
                            if (!open) setSelectedNewPath(null)
                          }}
                        >
                          <div />
                        </ChangeDataFolderLocation>
                      )}
                    </>
                  }
                />
                <CardItem
                  title={t('settings:dataFolder.appLogs', { ns: 'settings' })}
                  description={t('settings:dataFolder.appLogsDesc')}
                  className="items-start flex-row gap-y-2"
                  actions={
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="p-0"
                        onClick={revealLogsFolder}
                        title={t('settings:general.revealLogs')}
                      >
                        <Folder size={12} className="text-muted-foreground" />
                        <span>{openFileTitle()}</span>
                      </Button>
                    </div>
                  }
                />
              </Card>

              {/* Advanced - Desktop only */}
              <Card title="Advanced">
                <CardItem
                  title={t('settings:others.resetFactory', { ns: 'settings' })}
                  description={t('settings:others.resetFactoryDesc', {
                    ns: 'settings',
                  })}
                  actions={
                    <FactoryResetDialog onReset={resetApp}>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isResetting}
                      >
                        {isResetting
                          ? t('common:resetting', {
                              defaultValue: 'Resetting...',
                            })
                          : t('common:reset')}
                      </Button>
                    </FactoryResetDialog>
                  }
                />
              </Card>

              {/* Other */}
              <Card title={t('common:others')}>
                <CardItem
                  title={t('settings:others.spellCheck', { ns: 'settings' })}
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
                        onClick={validateHuggingFaceToken}
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
                    <ExternalTextLink
                      href={AX_STUDIO_EXTERNAL_LINKS.documentation}
                      label={t('settings:general.viewDocs')}
                    />
                  }
                />
                <CardItem
                  title={t('settings:general.releaseNotes')}
                  description={t('settings:general.releaseNotesDesc')}
                  actions={
                    <ExternalTextLink
                      href={AX_STUDIO_EXTERNAL_LINKS.releases}
                      label={t('settings:general.viewReleases')}
                    />
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
                      href={AX_STUDIO_EXTERNAL_LINKS.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Github size={18} className="text-muted-foreground" />
                    </a>
                  }
                />
                <CardItem
                  title={t('settings:general.discord')}
                  description={t('settings:general.discordDesc')}
                  actions={
                    <a
                      href={AX_STUDIO_EXTERNAL_LINKS.discord}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MessageCircle
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
                    <ExternalTextLink
                      href={AX_STUDIO_EXTERNAL_LINKS.issueChooser}
                      label={t('settings:general.reportIssue')}
                    />
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
