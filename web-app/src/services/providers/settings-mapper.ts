import type {
  ControllerType,
  InputAction,
  InputType,
  SettingComponentProps,
} from '@ax-studio/core'
import { parsePlainDecimalNumber } from '@/lib/utils/decimal'

const DEFAULT_CONTEXT_WINDOW_SETTING_VALUE = 8192
const CONTROLLER_TYPES = new Set<ControllerType>([
  'slider',
  'checkbox',
  'input',
  'tag',
  'dropdown',
])
const INPUT_TYPES = new Set<InputType>([
  'password',
  'text',
  'email',
  'number',
  'tel',
  'url',
  'dropdown',
])
const INPUT_ACTIONS = new Set<InputAction>(['unobscure', 'copy'])

type LegacyProviderSettingShape = {
  key: string
  title: string
  description: string
  controller_type: string
  controller_props: ProviderSetting['controller_props']
}

function isEngineSettingShape(
  setting: SettingComponentProps | LegacyProviderSettingShape
): setting is SettingComponentProps {
  return 'controllerType' in setting
}

function toProviderSetting(
  setting: SettingComponentProps | LegacyProviderSettingShape
): ProviderSetting {
  const engineSetting = isEngineSettingShape(setting)
  const controllerProps: ProviderSetting['controller_props'] = engineSetting
    ? toProviderControllerProps(setting.controllerProps)
    : { ...setting.controller_props }

  return {
    key: setting.key,
    title: setting.title,
    description: setting.description,
    controller_type: engineSetting
      ? setting.controllerType
      : setting.controller_type,
    controller_props: controllerProps,
  }
}

function toProviderControllerProps(
  props: SettingComponentProps['controllerProps']
): ProviderSetting['controller_props'] {
  const value = Array.isArray(props.value) ? props.value.join(',') : props.value
  const normalized: ProviderSetting['controller_props'] = { value }

  if ('placeholder' in props) normalized.placeholder = props.placeholder
  if ('type' in props) normalized.type = props.type
  if ('options' in props) normalized.options = props.options
  if ('recommended' in props) normalized.recommended = props.recommended
  if ('inputActions' in props) normalized.input_actions = props.inputActions
  if ('min' in props) normalized.min = props.min
  if ('max' in props) normalized.max = props.max
  if ('step' in props) normalized.step = props.step

  return normalized
}

function normalizeControllerType(value: string): ControllerType {
  return CONTROLLER_TYPES.has(value as ControllerType)
    ? (value as ControllerType)
    : 'input'
}

function normalizeInputType(value: string | undefined): InputType | undefined {
  return value && INPUT_TYPES.has(value as InputType)
    ? (value as InputType)
    : undefined
}

function coerceFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  const parsed = parsePlainDecimalNumber(value)
  return parsed !== null && Number.isFinite(parsed) ? parsed : undefined
}

function normalizeInputActions(value: string[] | undefined): InputAction[] {
  return (value ?? []).filter((action): action is InputAction =>
    INPUT_ACTIONS.has(action as InputAction)
  )
}

function toCoreControllerProps(
  controllerType: ControllerType,
  props: ProviderSetting['controller_props']
): SettingComponentProps['controllerProps'] {
  const normalized: Record<string, unknown> = {}

  switch (controllerType) {
    case 'slider': {
      // Accept numeric strings from JSON/UI; only fall back to 0 when unparsable.
      const parsedValue =
        typeof props.value === 'number'
          ? props.value
          : parsePlainDecimalNumber(props.value)
      normalized.value =
        typeof parsedValue === 'number' && Number.isFinite(parsedValue)
          ? parsedValue
          : 0
      const min = coerceFiniteNumber(props.min)
      const max = coerceFiniteNumber(props.max)
      const step = coerceFiniteNumber(props.step)
      if (min !== undefined) normalized.min = min
      if (max !== undefined) normalized.max = max
      if (step !== undefined) normalized.step = step
      break
    }
    case 'checkbox':
      normalized.value =
        typeof props.value === 'boolean' ? props.value : false
      break
    case 'dropdown': {
      normalized.value =
        typeof props.value === 'string' ? props.value : String(props.value ?? '')
      const inputType = normalizeInputType(props.type)
      if (inputType) normalized.type = inputType
      if (props.options) {
        normalized.options = props.options.map((option) => ({
          name: option.name,
          value: String(option.value),
        }))
      }
      if (props.recommended) normalized.recommended = props.recommended
      break
    }
    case 'input':
    case 'tag': {
      normalized.value =
        typeof props.value === 'string' || Array.isArray(props.value)
          ? props.value
          : String(props.value ?? '')
      if (typeof props.placeholder === 'string') {
        normalized.placeholder = props.placeholder
      }
      const inputType = normalizeInputType(props.type)
      if (inputType) normalized.type = inputType
      if (props.input_actions) {
        normalized.inputActions = normalizeInputActions(props.input_actions)
      }
      break
    }
  }

  // Provider updates may contain only the fields being changed. The core
  // extension layer merges these with controller defaults on first use.
  return normalized as SettingComponentProps['controllerProps']
}

export function buildRuntimeModelSettings(
  settings: Array<SettingComponentProps | LegacyProviderSettingShape>
): Record<string, ProviderSetting> {
  return settings.reduce<Record<string, ProviderSetting>>((acc, setting) => {
    const converted = toProviderSetting(setting)

    if (converted.key === 'ctx_len') {
      converted.controller_props.value = DEFAULT_CONTEXT_WINDOW_SETTING_VALUE
    }

    acc[converted.key] = converted
    return acc
  }, {})
}

export function cloneProviderSettings(
  settings: Record<string, ProviderSetting>
): Record<string, ProviderSetting> {
  return Object.entries(settings).reduce<Record<string, ProviderSetting>>(
    (acc, [key, setting]) => {
      acc[key] = {
        ...setting,
        controller_props: {
          ...(setting.controller_props ?? {}),
        },
      }
      return acc
    },
    {}
  )
}

export function toSettingComponentProps(
  setting: ProviderSetting
): SettingComponentProps {
  const controllerType = normalizeControllerType(setting.controller_type)
  return {
    key: setting.key,
    title: setting.title,
    description: setting.description,
    controllerType,
    controllerProps: toCoreControllerProps(
      controllerType,
      setting.controller_props ?? {}
    ),
  }
}

export function toSettingComponentPropsList(
  settings: ProviderSetting[]
): SettingComponentProps[] {
  return settings.map(toSettingComponentProps)
}
