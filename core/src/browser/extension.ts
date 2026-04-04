import { Model, SettingComponentProps } from '../types'
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

/**
 * Represents a base extension.
 * This class should be extended by any class that represents an extension.
 */
export abstract class BaseExtension implements ExtensionType {
  protected settingFolderName = 'settings'
  protected settingFileName = 'settings.json'

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
  abstract onLoad(): void

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
      console.error('Extension name is not defined')
      return
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

      if ('options' in setting.controllerProps) {
        setting.controllerProps.options = setting.controllerProps.options?.length
          ? setting.controllerProps.options
          : oldSetting.controllerProps?.options

        if (!setting.controllerProps.options?.some((entry) => entry.value === setting.controllerProps.value)) {
          setting.controllerProps.value =
            setting.controllerProps.options?.[0]?.value ?? setting.controllerProps.value
        }
      }

      if ('recommended' in setting.controllerProps) {
        const oldRecommended = oldSetting.controllerProps?.recommended
        if (oldRecommended !== undefined && oldRecommended !== '') {
          setting.controllerProps.recommended = oldRecommended
        }
      }
    })

    if (!this.writeStorageItem(this.name, JSON.stringify(normalizedSettings))) {
      throw new Error(`Failed to register settings for "${this.name}"`)
    }
  }

  /**
   * Get the setting value for the key.
   * @param key
   * @param defaultValue
   * @returns
   */
  async getSetting<T>(key: string, defaultValue: T) {
    const keySetting = (await this.getSettings()).find((setting) => setting.key === key)

    const value = keySetting?.controllerProps.value
    return (value as T) ?? defaultValue
  }

  onSettingUpdate<T>(key: string, value: T) {
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
    return this.parseStoredSettings(this.readStorageItem(this.name), this.name)
  }

  /**
   * Update the settings for the extension.
   * @param componentProps
   * @returns
   */
  async updateSettings(componentProps: Partial<SettingComponentProps>[]): Promise<void> {
    if (!this.name) return

    const settings = await this.getSettings()

    let updatedSettings = settings.map((setting) => {
      const updatedSetting = componentProps.find(
        (componentProp) => componentProp.key === setting.key
      )
      const nextSetting = {
        ...setting,
        controllerProps: { ...setting.controllerProps },
      }
      if (updatedSetting && updatedSetting.controllerProps) {
        nextSetting.controllerProps.value = updatedSetting.controllerProps.value
      }
      return nextSetting
    })

    if (!updatedSettings.length) updatedSettings = componentProps as SettingComponentProps[]

    if (!this.writeStorageItem(this.name, JSON.stringify(updatedSettings))) {
      throw new Error(`Failed to update settings for "${this.name}"`)
    }

    updatedSettings.forEach((setting) => {
      this.onSettingUpdate<typeof setting.controllerProps.value>(
        setting.key,
        setting.controllerProps.value
      )
    })
  }
}
