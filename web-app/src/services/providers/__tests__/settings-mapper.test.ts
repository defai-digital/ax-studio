import { describe, expect, it } from 'vitest'
import { toSettingComponentProps } from '../settings-mapper'
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
