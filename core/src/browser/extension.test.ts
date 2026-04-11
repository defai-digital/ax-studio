import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BaseExtension } from './extension'
import { SettingComponentProps } from '../types'
vi.mock('./core')
vi.mock('./fs')

class TestBaseExtension extends BaseExtension {
  onLoad(): void {}
  onUnload(): void {}
}

describe('BaseExtension', () => {
  let baseExtension: TestBaseExtension

  beforeEach(() => {
    baseExtension = new TestBaseExtension('https://example.com', 'TestExtension')
    const localStorageMock = (() => {
      let store: Record<string, string> = {}

      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
          store[key] = value
        },
        removeItem: (key: string) => {
          delete store[key]
        },
        clear: () => {
          store = {}
        },
      }
    })()

    Object.defineProperty(global, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should have the correct properties', () => {
    expect(baseExtension.name).toBe('TestExtension')
    expect(baseExtension.productName).toBeUndefined()
    expect(baseExtension.url).toBe('https://example.com')
    expect(baseExtension.active).toBeUndefined()
    expect(baseExtension.description).toBeUndefined()
    expect(baseExtension.version).toBeUndefined()
  })

  it('should return undefined for type()', () => {
    expect(baseExtension.type()).toBeUndefined()
  })

  it('should have abstract methods onLoad() and onUnload()', () => {
    expect(baseExtension.onLoad).toBeDefined()
    expect(baseExtension.onUnload).toBeDefined()
  })

  it('should install the extension', async () => {
    await baseExtension.install()
    // Add your assertions here
  })
})

describe('BaseExtension', () => {
  class TestBaseExtension extends BaseExtension {
    onLoad(): void {}
    onUnload(): void {}
  }

  let baseExtension: TestBaseExtension

  beforeEach(() => {
    baseExtension = new TestBaseExtension('https://example.com', 'TestExtension')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should have the correct properties', () => {
    expect(baseExtension.name).toBe('TestExtension')
    expect(baseExtension.productName).toBeUndefined()
    expect(baseExtension.url).toBe('https://example.com')
    expect(baseExtension.active).toBeUndefined()
    expect(baseExtension.description).toBeUndefined()
    expect(baseExtension.version).toBeUndefined()
  })

  it('should return undefined for type()', () => {
    expect(baseExtension.type()).toBeUndefined()
  })

  it('should have abstract methods onLoad() and onUnload()', () => {
    expect(baseExtension.onLoad).toBeDefined()
    expect(baseExtension.onUnload).toBeDefined()
  })

  it('should install the extension', async () => {
    await baseExtension.install()
    // Add your assertions here
  })

  it('should register settings', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
      { key: 'setting2', controllerProps: { value: 'value2' } } as any,
    ]
    const mock = vi.spyOn(localStorage, 'setItem')
    await baseExtension.registerSettings(settings)

    expect(mock).toHaveBeenCalledWith(
      'TestExtension',
      JSON.stringify([
        {
          key: 'setting1',
          controllerProps: { value: 'value1' },
          extensionName: 'TestExtension',
        },
        {
          key: 'setting2',
          controllerProps: { value: 'value2' },
          extensionName: 'TestExtension',
        },
      ])
    )
  })

  it('should not mutate the caller settings array during registration', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]
    const snapshot = JSON.parse(JSON.stringify(settings))

    await baseExtension.registerSettings(settings)

    expect(settings).toEqual(snapshot)
    expect((settings[0] as Record<string, unknown>).extensionName).toBeUndefined()
  })

  it('should get setting with default value', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    vi.spyOn(baseExtension, 'getSettings').mockResolvedValue(settings)

    const value = await baseExtension.getSetting('setting1', 'defaultValue')
    expect(value).toBe('value1')

    const defaultValue = await baseExtension.getSetting('setting2', 'defaultValue')
    expect(defaultValue).toBe('defaultValue')
  })

  it('should update settings', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    vi.spyOn(baseExtension, 'getSettings').mockResolvedValue(settings)
    const mockSetItem = vi.spyOn(localStorage, 'setItem')

    await baseExtension.updateSettings([
      { key: 'setting1', controllerProps: { value: 'newValue' } } as any,
    ])

    expect(mockSetItem).toHaveBeenCalledWith(
      'TestExtension',
      JSON.stringify([{ key: 'setting1', controllerProps: { value: 'newValue' } }])
    )
  })

  it('should ignore malformed stored settings during registration', async () => {
    localStorage.setItem('TestExtension', '{"bad":true}')

    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    await expect(baseExtension.registerSettings(settings)).resolves.toBeUndefined()
  })

  it('should return empty settings for malformed stored settings', async () => {
    localStorage.setItem('TestExtension', '{"bad":true}')

    await expect(baseExtension.getSettings()).resolves.toEqual([])
  })

  it('should throw when settings cannot be persisted during registration', async () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    await expect(baseExtension.registerSettings(settings)).rejects.toThrow(
      'Failed to register settings for "TestExtension"'
    )

    setItemSpy.mockRestore()
  })

  it('should throw when registering settings without an extension name', async () => {
    const unnamedExtension = new TestBaseExtension('https://example.com', '')

    await expect(
      unnamedExtension.registerSettings([
        { key: 'setting1', controllerProps: { value: 'value1' } } as any,
      ])
    ).rejects.toThrow('Cannot register settings: extension name is not defined')
  })

  it('should throw when settings cannot be persisted during update', async () => {
    const settings: SettingComponentProps[] = [
      { key: 'setting1', controllerProps: { value: 'value1' } } as any,
    ]

    vi.spyOn(baseExtension, 'getSettings').mockResolvedValue(settings)
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    await expect(
      baseExtension.updateSettings([
        { key: 'setting1', controllerProps: { value: 'newValue' } } as any,
      ])
    ).rejects.toThrow('Failed to update settings for "TestExtension"')

    setItemSpy.mockRestore()
  })

  it('should reset dropdown value when persisted value is no longer valid', async () => {
    localStorage.clear()

    const oldSettings = [
      {
        key: 'flash_attn',
        controllerProps: {
          value: 'ON',
          options: [
            { value: 'auto', name: 'Auto' },
            { value: 'on', name: 'ON' },
            { value: 'off', name: 'OFF' },
          ],
        },
      },
    ]

    localStorage.setItem('TestExtension', JSON.stringify(oldSettings))

    const newSettings: SettingComponentProps[] = [
      {
        key: 'flash_attn',
        controllerProps: {
          value: 'auto',
          options: [
            { value: 'auto', name: 'Auto' },
            { value: 'on', name: 'On' },
            { value: 'off', name: 'Off' },
          ],
        },
      } as any,
    ]

    const setItemSpy = vi.spyOn(localStorage, 'setItem')

    await baseExtension.registerSettings(newSettings)

    expect(setItemSpy).toHaveBeenCalled()
    const [, latestPayload] = setItemSpy.mock.calls[setItemSpy.mock.calls.length - 1]
    const persistedSettings = JSON.parse(latestPayload)
    const flashSetting = persistedSettings.find(
      (setting: any) => setting.key === 'flash_attn'
    )

    expect(flashSetting.controllerProps.value).toBe('auto')

    setItemSpy.mockRestore()
    localStorage.clear()
  })

  it('should backfill valid default controller props on first-time update', async () => {
    vi.spyOn(baseExtension, 'getSettings').mockResolvedValue([])
    const setItemSpy = vi.spyOn(localStorage, 'setItem')

    await baseExtension.updateSettings([
      {
        key: 'enabled',
        title: 'Enabled',
        description: 'Toggle',
        controllerType: 'checkbox',
      },
      {
        key: 'endpoint',
        title: 'Endpoint',
        description: 'URL',
        controllerType: 'input',
      },
    ] as Partial<SettingComponentProps>[])

    const [, payload] = setItemSpy.mock.calls[setItemSpy.mock.calls.length - 1]
    const parsed = JSON.parse(payload)

    expect(parsed).toEqual([
      expect.objectContaining({
        key: 'enabled',
        controllerProps: { value: false },
      }),
      expect.objectContaining({
        key: 'endpoint',
        controllerProps: { placeholder: '', value: '' },
      }),
    ])
  })
})
