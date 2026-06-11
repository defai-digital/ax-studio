import { expectTypeOf, it } from 'vitest'
import type { SettingComponentProps as ReExportedSettingComponentProps } from './index'
import type { SettingComponentProps as DirectSettingComponentProps } from './settingComponent'

it('re-exports SettingComponentProps from settingComponent', () => {
  expectTypeOf<ReExportedSettingComponentProps>().toEqualTypeOf<DirectSettingComponentProps>()
})
