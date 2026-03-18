import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useHardware } from '@/hooks/useHardware'
import { useLlamacppDevices } from '@/hooks/useLlamacppDevices'
import { useBackendUpdater } from '@/hooks/useBackendUpdater'
import { useEffect, useState } from 'react'
import { IconDeviceDesktopAnalytics } from '@tabler/icons-react'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { HardwareData, SystemUsage } from '@/services/hardware/types'
import { Cpu as CpuIcon } from 'lucide-react'
import { cn, formatMegaBytes } from '@/lib/utils'
import { toNumber } from '@/utils/number'
import { Button } from '@/components/ui/button'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { PlatformFeatures, PlatformFeature } from '@/lib/platform'
import { toast } from 'sonner'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.hardware as any)({
  component: HardwareContent,
})

function HardwareContent() {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const serviceHub = useServiceHub()
  const {
    hardwareData,
    systemUsage,
    setHardwareData,
    updateSystemUsage,
    pollingPaused,
  } = useHardware()
  const { providers } = useModelProvider()
  const llamacpp = providers.find((p) => p.provider === 'llamacpp')
  const setActiveModels = useAppState((state) => state.setActiveModels)

  // Llamacpp GPU devices — skip on macOS (Metal is managed internally)
  const llamacppDevicesResult = useLlamacppDevices()
  const {
    devices: llamacppDevices,
    loading: llamacppDevicesLoading,
    error: llamacppDevicesError,
    toggleDevice,
    fetchDevices,
  } = IS_MACOS
    ? {
        devices: [] as ReturnType<typeof useLlamacppDevices.getState>['devices'],
        loading: false,
        error: null as string | null,
        toggleDevice: (_id: string) => {},
        fetchDevices: async () => {},
      }
    : llamacppDevicesResult

  // Backend updater
  const {
    updateState,
    checkForUpdate,
    updateBackend,
    installBackend,
  } = useBackendUpdater()

  // Handle "Update Now" click
  const handleUpdateBackend = async () => {
    try {
      await updateBackend()
      toast.success(t('settings:backendUpdater.updateSuccess'))
    } catch {
      toast.error(t('settings:backendUpdater.updateError'))
    }
  }

  // Handle "Select File" click — open native file picker
  const handleManualInstall = async () => {
    try {
      const selected = await serviceHub.dialog().open({
        multiple: false,
        filters: [{ name: 'Backend Archive', extensions: ['gz', 'zip'] }],
      })
      if (selected && typeof selected === 'string') {
        await installBackend(selected)
        toast.success(t('settings:backendInstallSuccess'))
      }
    } catch {
      toast.error(t('settings:backendInstallError'))
    }
  }

  // Fetch llamacpp devices when page mounts
  useEffect(() => {
    if (!IS_MACOS && llamacpp) {
      fetchDevices()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch initial hardware info and system usage
  useEffect(() => {
    setIsLoading(true)
    Promise.all([
      serviceHub
        .hardware()
        .getHardwareInfo()
        .then((data: HardwareData | null) => {
          if (data) setHardwareData(data)
        })
        .catch((error) => {
          console.error('Failed to get hardware info:', error)
        }),
      serviceHub
        .hardware()
        .getSystemUsage()
        .then((data: SystemUsage | null) => {
          if (data) updateSystemUsage(data)
        })
        .catch((error: unknown) => {
          console.error('Failed to get initial system usage:', error)
        }),
    ]).finally(() => {
      setIsLoading(false)
    })
  }, [serviceHub, setHardwareData, updateSystemUsage])

  useEffect(() => {
    if (pollingPaused) {
      return
    }
    const intervalId = setInterval(() => {
      serviceHub
        .hardware()
        .getSystemUsage()
        .then((data: SystemUsage | null) => {
          if (data) updateSystemUsage(data)
        })
        .catch((error: unknown) => {
          console.error('Failed to get system usage:', error)
        })
    }, 5000)

    return () => clearInterval(intervalId)
  }, [serviceHub, updateSystemUsage, pollingPaused])

  const handleClickSystemMonitor = async () => {
    try {
      await serviceHub.window().openSystemMonitorWindow()
    } catch (error) {
      console.error('Failed to open system monitor window:', error)
    }
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 relative z-50"
            onClick={handleClickSystemMonitor}
          >
            <IconDeviceDesktopAnalytics className="text-muted-foreground size-5" />
            <p>{t('settings:hardware.systemMonitor')}</p>
          </Button>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
            <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
              <CpuIcon className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1 className="text-foreground tracking-tight" style={{ fontSize: '16px', fontWeight: 600 }}>
              {t('common:hardware')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-muted-foreground">
                Loading hardware information...
              </div>
            </div>
          ) : (
            <>
              {/* OS Information */}
              <Card title={t('settings:hardware.os')}>
                <CardItem
                  title={t('settings:hardware.name')}
                  actions={
                    <span className="text-foreground capitalize">
                      {hardwareData.os_type}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.version')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.os_name}
                    </span>
                  }
                />
              </Card>

              {/* CPU Information */}
              <Card title={t('settings:hardware.cpu')}>
                <CardItem
                  title={t('settings:hardware.model')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.cpu?.name}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.architecture')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.cpu?.arch}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.cores')}
                  actions={
                    <span className="text-foreground">
                      {hardwareData.cpu?.core_count}
                    </span>
                  }
                />
                {hardwareData.cpu?.extensions?.join(', ').length > 0 && (
                  <CardItem
                    title={t('settings:hardware.instructions')}
                    column={hardwareData.cpu?.extensions.length > 6}
                    actions={
                      <span className="text-foreground wrap-break-word">
                        {hardwareData.cpu?.extensions?.join(', ')}
                      </span>
                    }
                  />
                )}
                <CardItem
                  title={t('settings:hardware.usage')}
                  actions={
                    <div className="flex items-center gap-2">
                      {systemUsage.cpu > 0 && (
                        <>
                          <Progress
                            value={systemUsage.cpu}
                            className="h-2 w-10 border"
                          />
                          <span className="text-foreground">
                            {systemUsage.cpu?.toFixed(2)}%
                          </span>
                        </>
                      )}
                    </div>
                  }
                />
              </Card>

              {/* RAM Information */}
              <Card title={t('settings:hardware.memory')}>
                <CardItem
                  title={t('settings:hardware.totalRam')}
                  actions={
                    <span className="text-foreground">
                      {formatMegaBytes(hardwareData.total_memory)}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.availableRam')}
                  actions={
                    <span className="text-foreground">
                      {formatMegaBytes(
                        hardwareData.total_memory - systemUsage.used_memory
                      )}
                    </span>
                  }
                />
                <CardItem
                  title={t('settings:hardware.usage')}
                  actions={
                    <div className="flex items-center gap-2">
                      {hardwareData.total_memory > 0 && (
                        <>
                          <Progress
                            value={
                              toNumber(
                                systemUsage.used_memory /
                                  hardwareData.total_memory
                              ) * 100
                            }
                            className="h-2 w-10 border"
                          />
                          <span className="text-foreground">
                            {(
                              toNumber(
                                systemUsage.used_memory /
                                  hardwareData.total_memory
                              ) * 100
                            ).toFixed(2)}
                            %
                          </span>
                        </>
                      )}
                    </div>
                  }
                />
              </Card>

              {/* GPU Devices for Local Inference (non-macOS only, hidden when no GPUs present) */}
              {!IS_MACOS && llamacpp && (llamacppDevicesLoading || llamacppDevicesError || llamacppDevices.length > 0) && (
                <Card title={t('settings:hardware.gpus')}>
                  {llamacppDevicesLoading ? (
                    <CardItem title={t('settings:hardware.loadingDevices')} actions={<></>} />
                  ) : llamacppDevicesError ? (
                    <CardItem
                      title={t('settings:hardware.errorLoadingDevices')}
                      actions={
                        <span className="text-destructive text-sm">
                          {llamacppDevicesError}
                        </span>
                      }
                    />
                  ) : (
                    llamacppDevices.map((device, index) => (
                      <Card key={index}>
                        <CardItem
                          title={device.name}
                          actions={
                            <div className="flex items-center gap-4">
                              <Switch
                                checked={device.activated}
                                onCheckedChange={async () => {
                                  toggleDevice(device.id)
                                  try {
                                    await serviceHub.models().stopAllModels()
                                    const active = await serviceHub
                                      .models()
                                      .getActiveModels()
                                    setActiveModels(active || [])
                                  } catch (e) {
                                    console.error('Failed to stop models:', e)
                                  }
                                }}
                              />
                            </div>
                          }
                        />
                        <div className="mt-3">
                          <CardItem
                            title={t('settings:hardware.vram')}
                            actions={
                              <span className="text-foreground">
                                {formatMegaBytes(device.free)}{' '}
                                {t('settings:hardware.freeOf')}{' '}
                                {formatMegaBytes(device.mem)}
                              </span>
                            }
                          />
                        </div>
                      </Card>
                    ))
                  )}
                </Card>
              )}

              {/* Engine (llama.cpp) update section — desktop only */}
              {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
                <Card title={t('settings:hardware.engineUpdates')}>
                  <CardItem
                    title={t('settings:hardware.checkForBackendUpdates')}
                    description={t('settings:hardware.checkForBackendUpdatesDesc')}
                    actions={
                      updateState.isUpdateAvailable ? (
                        <Button
                          size="sm"
                          onClick={handleUpdateBackend}
                          disabled={updateState.isUpdating}
                        >
                          {updateState.isUpdating
                            ? t('settings:backendUpdater.updating')
                            : `${t('settings:hardware.updateNow')} (${updateState.updateInfo?.newVersion ?? ''})`}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => checkForUpdate(true)}
                        >
                          {t('settings:hardware.checkNow')}
                        </Button>
                      )
                    }
                  />
                  <CardItem
                    title={t('settings:hardware.installFromFile')}
                    description={t('settings:hardware.installFromFileDesc')}
                    actions={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleManualInstall}
                      >
                        {t('settings:hardware.selectFile')}
                      </Button>
                    }
                  />
                </Card>
              )}

            </>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
