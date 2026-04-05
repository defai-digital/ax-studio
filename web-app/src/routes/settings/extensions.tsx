import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { Card, CardItem } from '@/components/common/Card'

import SettingsMenu from '@/containers/SettingsMenu'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { ExtensionManager } from '@/lib/extension'
import { useTranslation } from '@/i18n/react-i18next-compat'
import HeaderPage from '@/containers/HeaderPage'
import { Puzzle } from 'lucide-react'

export const Route = createFileRoute(route.settings.extensions)({
  component: ExtensionsContent,
})

function ExtensionsContent() {
  const { t } = useTranslation()
  const extensions = ExtensionManager.getInstance().listExtensions()
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
              <Puzzle className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              Extensions
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {/* General */}
              <Card
                header={
                  <div className="flex items-center justify-between mb-4">
                    <h1 className="text-foreground font-studio font-medium text-base">
                      {t('settings:extensions.title')}
                    </h1>
                    {/* <div className="flex items-center gap-2">
                    <Button size="sm">Install Extension</Button>
                  </div> */}
                  </div>
                }
              >
                {extensions.map((item, i) => {
                  return (
                    <CardItem
                      key={i}
                      title={
                        <div className="flex items-center gap-x-2">
                          <h1 className="text-foreground font-studio font-medium text-base">
                            {item.productName ?? item.name}
                          </h1>
                          <div className="bg-foreground/10 px-1 py-0.5 rounded text-foreground/70 text-xs">
                            v{item.version}
                          </div>
                        </div>
                      }
                      description={
                        <RenderMarkdown
                          content={item.description ?? ''}
                          components={{
                            // Make links open in a new tab
                            a: ({ ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                            // Custom paragraph component remove margin
                            p: ({ ...props }) => (
                              <p {...props} className="mb-0!" />
                            ),
                          }}
                        />
                      }
                    />
                  )
                })}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
