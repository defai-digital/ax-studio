import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useState, useMemo } from 'react'
import type { ModelGroup } from '@/lib/model-group-utils'

type SelectModelGroupsProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Grouped model IDs from the upstream fetch */
  groups: ModelGroup[]
  /** Model IDs already present in the provider (used to pre-select groups) */
  existingModelIds: Set<string>
  /** Called with the model IDs from selected groups */
  onConfirm: (selectedModelIds: string[]) => void
}

export function SelectModelGroups({
  open,
  onOpenChange,
  groups,
  existingModelIds,
  onConfirm,
}: SelectModelGroupsProps) {
  // Pre-select groups that have at least one model already imported
  const initialSelection = useMemo(() => {
    const selected = new Set<string>()
    for (const group of groups) {
      if (group.modelIds.some((id) => existingModelIds.has(id))) {
        selected.add(group.prefix)
      }
    }
    return selected
  }, [groups, existingModelIds])

  const [selectedPrefixes, setSelectedPrefixes] = useState<Set<string>>(initialSelection)

  // Reset selection when dialog opens with new data
  const [prevGroups, setPrevGroups] = useState(groups)
  if (groups !== prevGroups) {
    setPrevGroups(groups)
    setSelectedPrefixes(initialSelection)
  }

  const toggleGroup = (prefix: string) => {
    setSelectedPrefixes((prev) => {
      const next = new Set(prev)
      if (next.has(prefix)) {
        next.delete(prefix)
      } else {
        next.add(prefix)
      }
      return next
    })
  }

  const selectedCount = groups
    .filter((g) => selectedPrefixes.has(g.prefix))
    .reduce((sum, g) => sum + g.modelIds.length, 0)

  const totalCount = groups.reduce((sum, g) => sum + g.modelIds.length, 0)

  const handleConfirm = () => {
    const selectedIds = groups
      .filter((g) => selectedPrefixes.has(g.prefix))
      .flatMap((g) => g.modelIds)
    onConfirm(selectedIds)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select model groups to import</DialogTitle>
          <DialogDescription>
            Found {totalCount} models across {groups.length} upstreams.
            Only import groups whose API keys are configured in your gateway.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 py-2">
          {groups.map((group) => {
            const isSelected = selectedPrefixes.has(group.prefix)
            const hasExisting = group.modelIds.some((id) => existingModelIds.has(id))

            return (
              <button
                key={group.prefix}
                type="button"
                className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                onClick={() => toggleGroup(group.prefix)}
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={isSelected}
                    onCheckedChange={() => toggleGroup(group.prefix)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="text-left">
                    <span className="text-sm font-medium">{group.displayName}</span>
                    {hasExisting && (
                      <span className="text-xs text-muted-foreground ml-2">(previously imported)</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.modelIds.length} {group.modelIds.length === 1 ? 'model' : 'models'}
                </span>
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleConfirm}
            disabled={selectedPrefixes.size === 0}
          >
            Import {selectedCount} {selectedCount === 1 ? 'model' : 'models'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
