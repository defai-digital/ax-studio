import { useState, useCallback } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { SmartStartWorkflow, WorkflowField } from '@/lib/smart-start/workflows'

interface WorkflowFormProps {
  workflow: SmartStartWorkflow
  onSubmit: (prompt: string) => void
  onCancel: () => void
}

function FieldRenderer({
  field,
  value,
  onChange,
}: {
  field: WorkflowField
  value: string
  onChange: (value: string) => void
}) {
  switch (field.type) {
    case 'text':
      return (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-9 text-sm"
        />
      )
    case 'textarea':
      return (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className="text-sm resize-none"
        />
      )
    case 'radio':
      return (
        <RadioGroup value={value} onValueChange={onChange} className="flex flex-wrap gap-2">
          {field.options?.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-1.5 cursor-pointer text-sm text-muted-foreground has-[:checked]:text-foreground"
            >
              <RadioGroupItem value={opt.value} className="size-3.5" />
              {opt.label}
            </label>
          ))}
        </RadioGroup>
      )
    default:
      return null
  }
}

export function WorkflowForm({ workflow, onSubmit, onCancel }: WorkflowFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const field of workflow.fields) {
      if (field.type === 'radio' && field.options?.length) {
        initial[field.id] = field.options[0].value
      } else {
        initial[field.id] = ''
      }
    }
    return initial
  })

  const handleChange = useCallback((fieldId: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
  }, [])

  const canSubmit = workflow.fields
    .filter((f) => f.required)
    .every((f) => values[f.id]?.trim())

  const handleSubmit = () => {
    if (!canSubmit) return
    const prompt = workflow.buildPrompt(values)
    onSubmit(prompt)
  }

  return (
    <div className="w-full max-w-lg mx-auto animate-in fade-in-0 slide-in-from-top-2 duration-200">
      <div className="rounded-xl border border-border bg-background/80 backdrop-blur-sm shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <workflow.icon className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{workflow.label}</span>
          </div>
          <button
            onClick={onCancel}
            className="size-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            type="button"
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Fields */}
        <div className="px-4 py-4 space-y-4">
          {workflow.fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <FieldRenderer
                field={field}
                value={values[field.id] ?? ''}
                onChange={(v) => handleChange(field.id, v)}
              />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            type="button"
          >
            Or just type freely...
          </button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-8 text-xs gap-1.5"
          >
            Start
            <ArrowRight className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
