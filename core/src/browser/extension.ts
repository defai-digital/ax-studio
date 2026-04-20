import { ControllerType, Model, SettingComponentProps } from '../types'
import { ModelManager } from './models'

export enum ExtensionTypeEnum {
  Assistant = 'assistant',
  Conversational = 'conversational',
  Model = 'model',
  SystemMonitoring = 'systemMonitoring',
  MCP = 'mcp',
  HuggingFace = 'huggingFace',
  Engine = 'engine',
  Hardware = 'hardware',
}

export interface ExtensionType {
  type(): ExtensionTypeEnum | undefined
}

export interface Compatibility {
  platform: string[]
  version: string
}

type ControllerProps = SettingComponentProps['controllerProps']

function isDropdownControllerProps(
  controllerProps: ControllerProps
): controllerProps is Extract<ControllerProps, { options?: unknown; recommended?: unknown }> {
  return 'options' in controllerProps || 'recommended' in controllerProps
}

function buildDefaultControllerProps(
  controllerType: ControllerType | undefined
): ControllerProps {
  switch (controllerType) {
    case 'checkbox':
      return { value: false }
    case 'slider':
      return { min: 0, max: 100, step: 1, value: 0 }
    case 'dropdown':
      return { value: '', options: [] }
    case 'tag':
    case 'input':
    default:
      return { placeholder: '', value: '' }
  }
}

/**
 * Represents a base extension.
 * This class should be extended by any class that represents an extension.
 */
export abstract class BaseExtension implements ExtensionType {
  protected settingFolderName = 'settings'
  protected settingFileName = 'settings.json'
  private settingsCache: SettingComponentProps[] | null = null

  /** @type {string} Name of the extension. */
  name: string

  /** @type {string} Product Name of the extension. */
  productName?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active

  /** @type {string} Extension's description. */
  description

  /** @type {string} Extension's version. */
  version

  private readStorageItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch (error) {
      console.warn(`Failed to read settings for "${key}"`, error)
      return null
    }
  }

  private writeStorageItem(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value)
      return true
    } catch (error) {
      console.error(`Failed to persist settings for "${key}"`, error)
      return false
    }
  }

  private isSettingsArray(value: unknown): value is SettingComponentProps[] {
    return Array.isArray(value) && value.every((item) => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<SettingComponentProps>
      return typeof candidate.key === 'string' && !!candidate.controllerProps
    })
  }

  private parseStoredSettings(raw: string | null, key: string): SettingComponentProps[] {
    if (!raw) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn(`Ignoring invalid stored settings for "${key}"`, error)
      return []
    }

    if (!this.isSettingsArray(parsed)) {
      console.warn(`Ignoring malformed stored settings for "${key}"`)
      return []
    }

    return parsed
  }

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    this.name = name
    this.productName = productName
    this.url = url
    this.active = active
    this.description = description
    this.version = version
  }

  /**
   * Returns the type of the extension.
   * @returns {ExtensionType} The type of the extension
   * Undefined means its not extending any known extension by the application.
   */
  type(): ExtensionTypeEnum | undefined {
    return undefined
  }

  /**
   * Called when the extension is loaded.
   * Any initialization logic for the extension should be put here.
   */
  abstract onLoad(): void | Promise<void>

  /**
   * Called when the extension is unloaded.
   * Any cleanup logic for the extension should be put here.
   */
  abstract onUnload(): void

  /**
   * The compatibility of the extension.
   * This is used to check if the extension is compatible with the current environment.
   * @property {Array} platform
   */
  compatibility(): Compatibility | undefined {
    return undefined
  }

  /**
   * Registers models - it persists in-memory shared ModelManager instance's data map.
   * @param models
   */
  async registerModels(models: Model[]): Promise<void> {
    for (const model of models) {
      ModelManager.instance().register(model)
    }
  }

  /**
   * Register settings for the extension.
   * @param settings
   * @returns
   */
  async registerSettings(settings: SettingComponentProps[]): Promise<void> {
    if (!this.name) {
      throw new Error('Cannot register settings: extension name is not defined')
    }

    if (!this.isSettingsArray(settings)) {
      throw new Error(`Invalid settings payload for "${this.name}"`)
    }

    const normalizedSettings = settings.map((setting) => ({
      ...setting,
      extensionName: this.name,
      controllerProps: { ...setting.controllerProps },
    }))

    const oldSettings = this.parseStoredSettings(
      this.readStorageItem(this.name),
      this.name
    )

    normalizedSettings.forEach((setting) => {
      const oldSetting = oldSettings.find((entry) => entry.key === setting.key)
      if (!oldSetting) return

      setting.controllerProps.value =
        oldSetting.controllerProps?.value ?? setting.controllerProps.value

      if (isDropdownControllerProps(setting.controllerProps)) {
        setting.controllerProps.options = setting.controllerProps.options?.length
          ? setting.controllerProps.options
          : isDropdownControllerProps(oldSetting.controllerProps)
            ? oldSetting.controllerProps.options
            : setting.controllerProps.options

        if (!setting.controllerProps.options?.some((entry) => entry.value === setting.controllerProps.value)) {
          setting.controllerProps.value =
            setting.controllerProps.options?.[0]?.value ?? setting.controllerProps.value
        }
      }

      if (isDropdownControllerProps(setting.controllerProps)) {
        const oldRecommended = isDropdownControllerProps(oldSetting.controllerProps)
          ? oldSetting.controllerProps.recommended
          : undefined
        if (oldRecommended !== undefined && oldRecommended !== '') {
          setting.controllerProps.recommended = oldRecommended
        }
      }
    })

    if (!this.writeStorageItem(this.name, JSON.stringify(normalizedSettings))) {
      throw new Error(`Failed to register settings for "${this.name}"`)
    }
    this.settingsCache = normalizedSettings
  }

  /**
   * Get the setting value for the key.
   * Runtime-coerces the stored value to match the default's type so callers
   * don't receive, e.g., string `"8080"` when they expected `number`.
   * @param key
   * @param defaultValue
   * @returns
   */
  async getSetting<T extends string | number | boolean | string[]>(
    key: string,
    defaultValue: T
  ): Promise<T> {
    const keySetting = (await this.getSettings()).find((setting) => setting.key === key)
    const value = keySetting?.controllerProps.value
    if (value === undefined || value === null) return defaultValue

    if (typeof defaultValue === 'number') {
      const coerced = typeof value === 'number' ? value : Number(value)
      return (Number.isFinite(coerced) ? coerced : defaultValue) as T
    }
    if (typeof defaultValue === 'boolean') {
      if (typeof value === 'boolean') return value as T
      if (typeof value === 'number') return (value !== 0) as T
      if (typeof value === 'string') return (value === 'true') as T
      return defaultValue
    }
    if (Array.isArray(defaultValue)) {
      return (Array.isArray(value) ? value : defaultValue) as T
    }
    // String default
    return (typeof value === 'string' ? value : String(value)) as T
  }

  onSettingUpdate<T>(_key: string, _value: T) {
    return
  }

  /**
   * Install the prerequisites for the extension.
   *
   * @returns {Promise<void>}
   */
  async install(): Promise<void> {
    return
  }

  /**
   * Get the settings for the extension.
   * @returns
   */
  async getSettings(): Promise<SettingComponentProps[]> {
    if (!this.name) return []
    if (this.settingsCache) return this.settingsCache
    this.settingsCache = this.parseStoredSettings(this.readStorageItem(this.name), this.name)
    return this.settingsCache
  }

  /**
   * Update the settings for the extension.
   * @param componentProps
   * @returns
   */
  async updateSettings(componentProps: Partial<SettingComponentProps>[]): Promise<void> {
    if (!this.name) return

    const settings = await this.getSettings()

    const updatesByKey = new Map<string, Partial<SettingComponentProps>>()
    for (const cp of componentProps) {
      if (cp.key) updatesByKey.set(cp.key, cp)
    }

    let updatedSettings = settings.map((setting) => {
      const updatedSetting = updatesByKey.get(setting.key)
      const nextSetting = {
        ...setting,
        controllerProps: { ...setting.controllerProps },
      }
      if (updatedSetting?.controllerProps) {
        nextSetting.controllerProps.value = updatedSetting.controllerProps.value
      }
      return nextSetting
    })

    if (!updatedSettings.length) {
      // First-time registration path: backfill required fields from sensible
      // defaults so we never persist malformed settings that would crash the
      // UI on the next load.
      updatedSettings = componentProps.map((cp) => ({
        ...cp,
        key: cp.key ?? '',
        title: cp.title ?? '',
        description: cp.description ?? '',
        controllerType: cp.controllerType ?? 'input',
        controllerProps:
          cp.controllerProps ??
          buildDefaultControllerProps(cp.controllerType ?? 'input'),
      })) as SettingComponentProps[]
    }

    if (!this.writeStorageItem(this.name, JSON.stringify(updatedSettings))) {
      throw new Error(`Failed to update settings for "${this.name}"`)
    }
    this.settingsCache = updatedSettings

    updatedSettings.forEach((setting) => {
      this.onSettingUpdate<typeof setting.controllerProps.value>(
        setting.key,
        setting.controllerProps.value
      )
    })
  }
}
