import { createFileRoute } from '@tanstack/react-router'
import { BarChart3, MessageSquareText, ShieldCheck } from 'lucide-react'
import { route } from '@/constants/routes'
import { SettingsMenu } from '@/components/common/SettingsMenu'
import { SettingsPageLayout } from '@/components/settings/SettingsPageLayout'
import { Badge } from '@/components/ui/badge'
import { HeaderPage } from '@/containers/HeaderPage'
import { AxBiConnectCard } from '@/containers/AxBiConnectCard'
import { useTranslation } from '@/i18n/react-i18next-compat'

export const Route = createFileRoute(route.settings.axBi)({
  component: AxBiSettings,
})

function AxBiSettings() {
  const { t } = useTranslation()

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage>
        <div className="flex w-full items-center gap-2">
          <span className="font-studio text-base font-medium">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex min-h-0 flex-1">
        <SettingsMenu />
        <div
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'thin' }}
        >
          <SettingsPageLayout
            icon={BarChart3}
            title={
              <span className="flex items-center gap-2">
                {t('common:axBi')}
                <Badge variant="amber" className="px-1.5 py-0 text-[10px]">
                  Beta
                </Badge>
              </span>
            }
            subtitle="Connect AX Studio to your local AX BI stack."
          />
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-5">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                AX BI works through chat. Ask AX Studio for a chart or dashboard
                and it delegates the request after this connection is active.
              </p>

              <AxBiConnectCard />

              <div className="rounded-xl border border-border/50 bg-card p-4">
                <div className="flex items-start gap-3">
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Use AX BI from chat</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Start a chat and ask for an analysis, chart, or dashboard.
                      Results remain attached to the conversation where the
                      request was made.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-start gap-3 border-t border-border/50 pt-4">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Local connection</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      AX Studio connects to the local AX BI MCP service and
                      stores its API key through the desktop secure credential
                      service.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
