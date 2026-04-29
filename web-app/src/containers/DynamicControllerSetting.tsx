import { useState } from 'react'
import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SliderProps } from '@radix-ui/react-slider'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { cn } from '@/lib/utils'
import { Copy, CheckCheck, Eye, EyeOff, Minus, Plus, ChevronsUpDown } from 'lucide-react'

// ─── InputControl ────────────────────────────────────────────────────────────

type InputControlProps = {
  type?: string
  placeholder?: string
  value: string | number
  onChange: (value: string) => void
  inputActions?: string[]
  className?: string
  min?: number
  max?: number
  step?: number
}

function InputControl({
  type = 'text',
  placeholder = '',
  value = '',
  onChange,
  className,
  inputActions = [],
  min,
  max,
  step = 1,
}: InputControlProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const hasInputActions = inputActions && inputActions.length > 0

  const copyToClipboard = () => {
    if (value) {
      navigator.clipboard.writeText(String(value))
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 1000)
    }
  }

  const inputType = type === 'password' && showPassword ? 'text' : type
  const hasValue = value !== undefined && value !== null && value !== ''
  const stringValue = hasValue ? String(value) : ''
  const numericValue = hasValue
    ? (typeof value === 'number' ? value : Number(value) || 0)
    : (min ?? 0)

  const handleNumberAdjustment = (delta: number) => {
    let newValue = numericValue + delta
    const decimals = (step.toString().split('.')[1] || '').length
    newValue = Number(newValue.toFixed(decimals))
    if (min !== undefined && newValue < min) newValue = min
    if (max !== undefined && newValue > max) newValue = max
    onChange(newValue.toString())
  }

  if (type === 'number') {
    return (
      <ButtonGroup className={className}>
        <Input
          value={stringValue || undefined}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-16 font-mono text-center text-xs!"
        />
        <Button variant="outline" size="icon-sm" type="button" aria-label="Decrement" className="rounded-none"
          onClick={() => handleNumberAdjustment(-step)}
          disabled={min !== undefined && numericValue <= min}
        >
          <Minus className="size-3! text-muted-foreground" />
        </Button>
        <Button variant="outline" size="icon-sm" type="button" aria-label="Increment" className="rounded-r-md"
          onClick={() => handleNumberAdjustment(step)}
          disabled={max !== undefined && numericValue >= max}
        >
          <Plus className="size-3! text-muted-foreground" />
        </Button>
      </ButtonGroup>
    )
  }

  return (
    <div className={cn('relative w-full', className)}>
      <Input
        type={inputType}
        placeholder={placeholder}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        className={cn('w-full', hasInputActions && 'pr-16')}
      />
      <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
        {hasInputActions && inputActions.includes('unobscure') && type === 'password' && (
          <button onClick={() => setShowPassword(!showPassword)} className="p-1 rounded text-muted-foreground">
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
        {hasInputActions && inputActions.includes('copy') && (
          <button onClick={copyToClipboard} className="p-1 rounded text-muted-foreground">
            {isCopied ? <CheckCheck className="text-primary" size={16} /> : <Copy size={16} />}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── SliderControl ───────────────────────────────────────────────────────────

interface SliderControlProps {
  sliderKey?: string
  title?: string
  value?: SliderProps['defaultValue']
  min?: number
  max?: number
  step?: number
  onChange?: (value: SliderProps['defaultValue']) => void
}

function SliderControl({ value, sliderKey, title, min = 0, max = 100, step = 1, onChange }: SliderControlProps) {
  const initialValue = Array.isArray(value) && value[0] !== undefined ? value : [min]
  const [currentValue, setCurrentValue] = React.useState<number[]>(initialValue)
  const [inputValue, setInputValue] = React.useState<string>(initialValue[0].toString())
  const [inputNumber, setInputNumber] = React.useState<number>(initialValue[0])
  const isExceedingMax = inputNumber > max

  React.useEffect(() => {
    if (Array.isArray(value) && value[0] !== undefined) {
      setCurrentValue(value)
      setInputValue(value[0].toString())
      setInputNumber(value[0])
    }
  }, [value])

  const handleValueChange = (newValue: SliderProps['defaultValue']) => {
    if (newValue) {
      setCurrentValue(newValue)
      setInputValue(newValue[0].toString())
      setInputNumber(newValue[0])
      onChange?.(newValue)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setInputValue(val)
    const newValue = parseFloat(val)
    if (!isNaN(newValue)) {
      setInputNumber(newValue)
      if (newValue >= min && newValue <= max) handleValueChange([newValue])
    }
  }

  return (
    <div className="grid gap-2 pt-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <div className="w-full space-y-2">
            <Slider id={sliderKey} min={min} max={max} step={step} value={currentValue}
              onValueChange={handleValueChange}
              className="**:[[role=slider]]:h-4 **:[[role=slider]]:w-4"
              aria-label={title}
            />
            <div className="flex justify-between px-1">
              <span className="text-xs text-muted-foreground">{min}</span>
              <span className="text-xs text-muted-foreground">{max}</span>
            </div>
          </div>
          <Input
            className={`w-16 h-8 -mt-6 rounded-md border px-2 text-right text-xs ${isExceedingMax ? 'border-destructive text-destructive' : 'text-muted-foreground'} transition-all duration-200 ease-in-out`}
            value={inputValue}
            onChange={handleInputChange}
          />
        </div>
      </div>
      {isExceedingMax && (
        <p className="text-xs text-destructive">Maximum value allowed is <span className="font-medium">{max}</span></p>
      )}
    </div>
  )
}

// ─── DynamicControllerSetting ────────────────────────────────────────────────

type DynamicControllerProps = {
  key?: string
  title?: string
  className?: string
  description?: string
  readonly?: boolean
  controllerType: 'input' | 'checkbox' | 'dropdown' | 'textarea' | 'slider' | string
  controllerProps: {
    value?: string | boolean | number
    placeholder?: string
    type?: string
    options?: Array<{ value: number | string; name: string }>
    input_actions?: string[]
    rows?: number
    min?: number
    max?: number
    step?: number
    recommended?: string
  }
  onChange: (value: string | boolean | number) => void
}

export function DynamicControllerSetting({
  className,
  controllerType,
  controllerProps,
  onChange,
}: DynamicControllerProps) {
  const { spellCheckChatInput } = useGeneralSetting()

  if (controllerType === 'input') {
    return (
      <InputControl
        type={controllerProps.type}
        placeholder={controllerProps.placeholder}
        value={typeof controllerProps.value === 'number' ? controllerProps.value : (controllerProps.value as string) || ''}
        inputActions={controllerProps.input_actions}
        className={className}
        min={controllerProps.min}
        max={controllerProps.max}
        step={controllerProps.step}
        onChange={(v) => onChange(v)}
      />
    )
  }

  if (controllerType === 'checkbox') {
    return (
      <Switch
        checked={controllerProps.value as boolean}
        onCheckedChange={(v) => onChange(v)}
      />
    )
  }

  if (controllerType === 'dropdown') {
    const options = controllerProps.options ?? []
    const selected = options.find((o) => o.value === controllerProps.value)?.name || (controllerProps.value as string)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between">
            {selected}
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-70">
          {options.map((option, i) => (
            <DropdownMenuItem key={i} onClick={() => onChange(option.value)}
              className={cn('flex items-center justify-between my-1', selected === option.name ? 'bg-secondary/60 hover:bg-secondary/40' : '')}
            >
              {option.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (controllerType === 'textarea') {
    return (
      <Textarea
        placeholder={controllerProps.placeholder ?? ''}
        value={(controllerProps.value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        rows={controllerProps.rows ?? 4}
        className={cn('w-full resize-none')}
        spellCheck={spellCheckChatInput}
        data-gramm={spellCheckChatInput}
        data-gramm_editor={spellCheckChatInput}
        data-gramm_grammarly={spellCheckChatInput}
      />
    )
  }

  if (controllerType === 'slider') {
    return (
      <SliderControl
        value={[controllerProps.value as number]}
        min={controllerProps.min}
        max={controllerProps.max}
        step={controllerProps.step}
        onChange={(v) => v && onChange(v[0])}
      />
    )
  }

  return <Switch checked={!!controllerProps.value} onCheckedChange={(v) => onChange(v)} />
}
