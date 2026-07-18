import { useState } from 'react'
import { Card, CardItem } from '@/components/common/Card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useMcpCatalog } from '@/hooks/tools/useMcpCatalog'
import { McpCatalogInstallDialog } from '@/containers/dialogs/mcp/McpCatalogInstallDialog'
import type { McpCatalogEntry } from '@/schemas/mcp-catalog.schema'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function McpCatalogSection() {
  const { t } = useTranslation()
  const { entries, isInstalled } = useMcpCatalog()
  const [installEntry, setInstallEntry] = useState<McpCatalogEntry | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (entries.length === 0) return null

  const handleInstallClick = (entry: McpCatalogEntry) => {
    setInstallEntry(entry)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4" data-testid="mcp-catalog-section">
      <div>
        <h2 className="text-foreground font-medium text-base font-studio">
          {t('mcp-servers:catalog.title')}
        </h2>
        <p className="text-sm mt-1 text-muted-foreground">
          {t('mcp-servers:catalog.description')}
        </p>
      </div>

      {entries.map((entry) => {
        const installed = isInstalled(entry.name)
        return (
          <Card key={entry.name}>
            <CardItem
              align="start"
              title={
                <div className="flex items-center gap-x-2 flex-wrap">
                  <h3 className="text-foreground text-base font-studio">
                    {entry.title}
                  </h3>
                  <Badge variant="emerald">
                    {t('mcp-servers:catalog.reviewedBadge')}
                  </Badge>
                </div>
              }
              descriptionOutside={
                <div className="text-sm text-muted-foreground">
                  <div className="mb-1">
                    {t('mcp-servers:catalog.publisher')}: {entry.publisher}
                  </div>
                  <p className="mb-1">{entry.description}</p>
                  <p className="mb-1 text-xs">{entry.capabilitiesNote}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <Badge variant="secondary">v{entry.version}</Badge>
                    <Badge variant="secondary" className="uppercase">
                      {entry.transport}
                    </Badge>
                  </div>
                </div>
              }
              actions={
                <Button
                  size="sm"
                  variant={installed ? 'outline' : 'default'}
                  disabled={installed}
                  onClick={() => handleInstallClick(entry)}
                >
                  {installed
                    ? t('mcp-servers:catalog.installed')
                    : t('mcp-servers:catalog.install')}
                </Button>
              }
            />
          </Card>
        )
      })}

      <McpCatalogInstallDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={installEntry}
      />
    </div>
  )
}
