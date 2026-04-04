import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TeamVariable } from '@/types/agent-team'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamName: string
  variables: TeamVariable[]
  onSubmit: (values: Record<string, string>) => void
}

export function TeamVariablePrompt({
  open,
  onOpenChange,
  teamName,
  variables,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const v of variables) {
      initial[v.name] = v.default_value ?? ''
    }
    return initial
  })

  // Reset values when variables prop changes (e.g., team switch)
  useEffect(() => {
    const updated: Record<string, string> = {}
    for (const v of variables) {
      updated[v.name] = v.default_value ?? ''
    }
    setValues(updated)
  }, [variables])

  const handleSubmit = () => {
    onSubmit(values)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Configure Team Variables</DialogTitle>
          <DialogDescription>
            Fill in the variables for &ldquo;{teamName}&rdquo; before starting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {variables.map((v) => (
            <div key={v.name} className="space-y-1">
              <label className="text-sm font-medium">{v.label || v.name}</label>
              {v.description && (
                <p className="text-xs text-muted-foreground">{v.description}</p>
              )}
              <Input
                value={values[v.name] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                }
                placeholder={v.default_value || v.label || v.name}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
