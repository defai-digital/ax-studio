import { expectTypeOf, it } from 'vitest'
import type {
  CheckboxComponentProps,
  DropdownComponentProps,
  InputComponentProps,
  SettingComponentProps,
  SliderComponentProps,
} from './settingComponent'

it('requires controllerProps compatible with the declared controller type contract', () => {
  const inputSetting = {
    key: 'api_key',
    title: 'API Key',
    description: 'Credential',
    controllerType: 'input',
    controllerProps: {
      placeholder: 'sk-...',
      value: '',
      type: 'password',
      inputActions: ['copy', 'unobscure'],
    },
    configType: 'setting',
  } satisfies SettingComponentProps

  const checkboxSetting = {
    key: 'enabled',
    title: 'Enabled',
    description: 'Toggle feature',
    controllerType: 'checkbox',
    controllerProps: {
      value: true,
    },
  } satisfies SettingComponentProps

  const sliderSetting = {
    key: 'temperature',
    title: 'Temperature',
    description: 'Sampling temperature',
    controllerType: 'slider',
    controllerProps: {
      min: 0,
      max: 2,
      step: 0.1,
      value: 1,
    },
  } satisfies SettingComponentProps

  const dropdownSetting = {
    key: 'provider',
    title: 'Provider',
    description: 'Select provider',
    controllerType: 'dropdown',
    controllerProps: {
      value: 'openai',
      options: [{ name: 'OpenAI', value: 'openai' }],
      recommended: 'openai',
    },
  } satisfies SettingComponentProps

  expectTypeOf(inputSetting.controllerProps).toMatchTypeOf<InputComponentProps>()
  expectTypeOf(checkboxSetting.controllerProps).toMatchTypeOf<CheckboxComponentProps>()
  expectTypeOf(sliderSetting.controllerProps).toMatchTypeOf<SliderComponentProps>()
  expectTypeOf(dropdownSetting.controllerProps).toMatchTypeOf<DropdownComponentProps>()
})
