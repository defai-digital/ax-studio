/**
 * CompareModelsDialog — lets the user pick the two models used in compare mode
 * before the two panes are created/bound.
 *
 * Uses plain <select> elements (grouped by provider) instead of the global
 * DropdownModelProvider, which is bound to the global model-provider store and
 * would clobber the user's selected model as a side effect.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useModelProvider } from '@/hooks/models/useModelProvider'

type CompareModelsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselects the left pane (typically the current thread's model). */
  defaultModelA?: ThreadModel
  onConfirm: (modelA: ThreadModel, modelB: ThreadModel) => void
}

/** Encode a ThreadModel as an option value without separator ambiguity. */
function encodeModel(model: ThreadModel): string {
  return JSON.stringify([model.provider, model.id])
}

function decodeModel(value: string): ThreadModel | undefined {
  try {
    const [provider, id] = JSON.parse(value)
    if (typeof provider === 'string' && typeof id === 'string') {
      return { provider, id }
    }
  } catch {
    // fall through
  }
  return undefined
}

export function CompareModelsDialog({
  open,
  onOpenChange,
  defaultModelA,
  onConfirm,
}: CompareModelsDialogProps) {
  const providers = useModelProvider((state) => state.providers)

  const providersWithModels = useMemo(
    () => providers.filter((p) => p.models.length > 0),
    [providers]
  )

  const [modelAValue, setModelAValue] = useState('')
  const [modelBValue, setModelBValue] = useState('')

  // (Re)initialize selections each time the dialog opens.
  useEffect(() => {
    if (!open) return
    const defaultValue = defaultModelA ? encodeModel(defaultModelA) : ''
    const exists = providersWithModels.some((p) =>
      p.models.some(
        (m) =>
          defaultModelA &&
          p.provider === defaultModelA.provider &&
          m.id === defaultModelA.id
      )
    )
    setModelAValue(exists ? defaultValue : '')
    setModelBValue('')
  }, [open, defaultModelA, providersWithModels])

  const modelA = modelAValue ? decodeModel(modelAValue) : undefined
  const modelB = modelBValue ? decodeModel(modelBValue) : undefined
  const canConfirm =
    !!modelA &&
    !!modelB &&
    (modelA.id !== modelB.id || modelA.provider !== modelB.provider)

  const handleConfirm = () => {
    if (!modelA || !modelB || !canConfirm) return
    onConfirm(modelA, modelB)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compare models</DialogTitle>
          <DialogDescription>
            Pick two models. Your prompt is sent to both, side by side.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label
              htmlFor="compare-model-a"
              className="text-sm font-medium leading-none"
            >
              Left pane
            </label>
            <select
              id="compare-model-a"
              aria-label="Left pane model"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={modelAValue}
              onChange={(e) => setModelAValue(e.target.value)}
            >
              <option value="" disabled>
                Select a model
              </option>
              {providersWithModels.map((provider) => (
                <optgroup key={provider.provider} label={provider.provider}>
                  {provider.models.map((model) => (
                    <option
                      key={model.id}
                      value={encodeModel({
                        provider: provider.provider,
                        id: model.id,
                      })}
                    >
                      {model.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label
              htmlFor="compare-model-b"
              className="text-sm font-medium leading-none"
            >
              Right pane
            </label>
            <select
              id="compare-model-b"
              aria-label="Right pane model"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={modelBValue}
              onChange={(e) => setModelBValue(e.target.value)}
            >
              <option value="" disabled>
                Select a model
              </option>
              {providersWithModels.map((provider) => (
                <optgroup key={provider.provider} label={provider.provider}>
                  {provider.models.map((model) => (
                    <option
                      key={model.id}
                      value={encodeModel({
                        provider: provider.provider,
                        id: model.id,
                      })}
                    >
                      {model.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Start comparing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
