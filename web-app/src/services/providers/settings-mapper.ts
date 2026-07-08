import type { SettingComponentProps } from '@ax-studio/core'

const DEFAULT_CONTEXT_WINDOW_SETTING_VALUE = 8192

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
  return {
    key: setting.key,
    title: setting.title,
    description: setting.description,
    controller_type: isEngineSettingShape(setting)
      ? setting.controllerType
      : setting.controller_type,
    controller_props: isEngineSettingShape(setting)
      ? setting.controllerProps
      : setting.controller_props,
  }
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

export function toSettingComponentProps(
  setting: ProviderSetting
): SettingComponentProps {
  return {
    key: setting.key,
    title: setting.title,
    description: setting.description,
    controllerType: setting.controller_type,
    controllerProps: {
      ...(setting.controller_props ?? {}),
      value:
        setting.controller_props?.value !== undefined ? setting.controller_props.value : '',
    },
  }
}

export function toSettingComponentPropsList(
  settings: ProviderSetting[]
): SettingComponentProps[] {
  return settings.map(toSettingComponentProps)
}
