import { describe, expect, it } from 'vitest'
import {
  buildRuntimeModelSettings,
  cloneProviderSettings,
  toSettingComponentProps,
} from '../settings-mapper'
import type { ProviderSetting } from '@/types/models'

describe('toSettingComponentProps slider mapping', () => {
  it('preserves numeric string values instead of coercing them to 0', () => {
    const setting = {
      key: 'ctx_len',
      title: 'Context',
      description: 'Context length',
      controller_type: 'slider',
      controller_props: {
        value: '8192',
        min: '0',
        max: '128000',
        step: '1',
      },
    } as unknown as ProviderSetting

    const mapped = toSettingComponentProps(setting)
    expect(mapped.controllerProps).toMatchObject({
      value: 8192,
      min: 0,
      max: 128000,
      step: 1,
    })
  })

  it('parses fractional string slider values', () => {
    const setting = {
      key: 'temperature',
      title: 'Temperature',
      description: '',
      controller_type: 'slider',
      controller_props: { value: '0.5', min: '0', max: '2', step: '0.1' },
    } as unknown as ProviderSetting

    expect(toSettingComponentProps(setting).controllerProps.value).toBe(0.5)
  })

  it('falls back to 0 for unparsable slider values', () => {
    const setting = {
      key: 'temperature',
      title: 'Temperature',
      description: '',
      controller_type: 'slider',
      controller_props: { value: 'not-a-number' },
    } as unknown as ProviderSetting

    expect(toSettingComponentProps(setting).controllerProps.value).toBe(0)
  })
})

describe('provider setting records', () => {
  it('preserves prototype-named settings as own entries', () => {
    const setting = {
      key: '__proto__',
      title: 'Special',
      description: '',
      controller_type: 'input',
      controller_props: { value: 'value' },
    } as ProviderSetting

    const built = buildRuntimeModelSettings([setting])
    const cloned = cloneProviderSettings(built)

    expect(Object.prototype.hasOwnProperty.call(built, '__proto__')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(cloned, '__proto__')).toBe(true)
    expect(cloned['__proto__']).not.toBe(built['__proto__'])
    expect(cloned['__proto__'].controller_props).not.toBe(
      built['__proto__'].controller_props
    )
  })
})
