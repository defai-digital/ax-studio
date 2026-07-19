import { AIEngine, BaseExtension, ExtensionTypeEnum } from '@ax-studio/core'

import { getServiceHub } from '@/hooks/useServiceHub'
import { ensureCoreBridge } from '@/lib/bootstrap/core-bridge'

/**
 * Extension manifest object.
 */
export class Extension {
  /** @type {string} Name of the extension. */
  name: string

  /** @type {string} Product name of the extension. */
  productName?: string

  /** @type {string} The URL of the extension to load. */
  url: string

  /** @type {boolean} Whether the extension is activated or not. */
  active?: boolean

  /** @type {string} Extension's description. */
  description?: string

  /** @type {string} Extension's version. */
  version?: string

  /** @type {BaseExtension} Pre-loaded extension instance for web extensions. */
  extensionInstance?: BaseExtension

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string,
    extensionInstance?: BaseExtension
  ) {
    this.name = name
    this.productName = productName
    this.url = url
    this.active = active
    this.description = description
    this.version = version
    this.extensionInstance = extensionInstance
  }
}

export type ExtensionManifest = {
  url: string
  name: string
  productName?: string
  active?: boolean
  description?: string
  version?: string
  extensionInstance?: BaseExtension // For web extensions
}

/** Resolve an extension entry only when it stays inside the managed directory. */
export function resolveLocalExtensionPath(
  extensionUrl: string,
  extensionsPath: string
): string {
  const raw = extensionUrl.trim().normalize('NFKC')
  const root = extensionsPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!raw || !root || /[\0\x00-\x1F\x7F-\x9F]/.test(raw)) {
    throw new Error('Invalid extension entry path')
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
    throw new Error('Remote and data extension URLs are not allowed')
  }
  if (raw.startsWith('//')) {
    throw new Error('Protocol-relative extension URLs are not allowed')
  }

  const normalized = raw.replace(/\\/g, '/')
  const isAbsolute = normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)
  const candidate = isAbsolute ? normalized : `${root}/${normalized}`
  const segments = candidate.split('/')
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Extension entry path escapes the managed directory')
  }

  const caseInsensitive = /^[a-z]:\//i.test(root)
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root
  const comparableCandidate = caseInsensitive
    ? candidate.toLowerCase()
    : candidate
  if (
    comparableCandidate !== comparableRoot &&
    !comparableCandidate.startsWith(`${comparableRoot}/`)
  ) {
    throw new Error('Extension entry path escapes the managed directory')
  }
  return candidate
}

/**
 * Manages the registration and retrieval of extensions.
 */
export class ExtensionManager {
  date = new Date().toISOString()
  // Registered extensions
  private extensions = new Map<string, BaseExtension>()

  // Registered inference engines
  private engines = new Map<string, AIEngine>()

  // Names of extensions that failed to activate/load during the last setup pass
  private failedExtensionNames = new Set<string>()

  /**
   * Returns display names of extensions that failed to activate or load
   * during the most recent register/load pass.
   */
  getFailedExtensionNames(): string[] {
    return [...this.failedExtensionNames]
  }

  /**
   * Registers an extension.
   * @param extension - The extension to register.
   */
  register<T extends BaseExtension>(name: string, extension: T) {
    // Register for naming use
    this.extensions.set(name, extension)

    // Register AI Engines
    if ('provider' in extension && typeof extension.provider === 'string') {
      this.engines.set(
        extension.provider as unknown as string,
        extension as unknown as AIEngine
      )
    }
  }

  /**
   * Retrieves a extension by its type.
   * @param type - The type of the extension to retrieve.
   * @returns The extension, if found.
   */
  get<T extends BaseExtension>(type: ExtensionTypeEnum): T | undefined {
    return this.getAll().find((e) => e.type() === type) as T | undefined
  }

  /**
   * Retrieves a registered extension by its name.
   * @param name - The name of the extension to retrieve.
   * @returns The extension, if found.
   */
  getByName(name: string): BaseExtension | undefined {
    return this.extensions.get(name) as BaseExtension | undefined
  }

  /**
   * Returns all registered extensions.
   * @returns An array of all registered extensions.
   */
  getAll(): BaseExtension[] {
    return Array.from(this.extensions.values())
  }

  /**
   * Retrieves a extension by its type.
   * @param engine - The engine name to retrieve.
   * @returns The extension, if found.
   */
  getEngine<T extends AIEngine>(engine: string): T | undefined {
    return this.engines.get(engine) as T | undefined
  }

  /**
   * Loads all registered extension.
   */
  async load() {
    const extensions = this.listExtensions()
    const results = await Promise.allSettled(
      extensions.map((ext) => ext.onLoad())
    )
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const ext = extensions[index]
        this.failedExtensionNames.add(ext.productName || ext.name)
        console.error('Extension load failed:', result.reason)
      }
    })
  }

  /**
   * Unloads all registered extensions.
   */
  unload() {
    this.listExtensions().forEach((ext) => {
      ext.onUnload()
    })
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  listExtensions() {
    return [...this.extensions.values()]
  }

  /**
   * Retrieves a list of all registered extensions.
   * @returns An array of extensions.
   */
  async getActive(): Promise<Extension[]> {
    const manifests = await getServiceHub().core().getActiveExtensions()
    if (!manifests || !Array.isArray(manifests)) return []

    const extensions: Extension[] = manifests.map(
      (manifest: ExtensionManifest) => {
        return new Extension(
          manifest.url,
          manifest.name,
          manifest.productName,
          manifest.active,
          manifest.description,
          manifest.version,
          manifest.extensionInstance // Pass the extension instance if available
        )
      }
    )

    return extensions
  }

  /**
   * Register a extension with its class.
   * @param {Extension} extension extension object as provided by the main process.
   * @returns {void}
   */
  async activateExtension(extension: Extension) {
    // Check if extension already has a pre-loaded instance (web extensions)
    if (extension.extensionInstance) {
      this.register(extension.name, extension.extensionInstance)
      return
    }

    // Import class for Tauri extensions
    try {
      const extensionsPath = await getServiceHub()
        .core()
        .invoke<string>('get_app_extensions_path')
      const extensionUrl = resolveLocalExtensionPath(
        extension.url,
        extensionsPath
      )

      const extensionClass = await import(
        /* @vite-ignore */ getServiceHub().core().convertFileSrc(extensionUrl)
      )
      // Register class if it has a default export
      if (
        typeof extensionClass.default === 'function' &&
        extensionClass.default.prototype
      ) {
        this.register(
          extension.name,
          new extensionClass.default(
            extension.url,
            extension.name,
            extension.productName,
            extension.active,
            extension.description,
            extension.version
          )
        )
      }
    } catch (error) {
      this.failedExtensionNames.add(extension.productName || extension.name)
      console.error(`Failed to import extension "${extension.name}":`, error)
    }
  }

  /**
   * Registers all active extensions.
   * @returns {void}
   */
  async registerActive() {
    // Reset failure tracking for this setup pass
    this.failedExtensionNames.clear()
    // Get active extensions
    const activeExtensions = await this.getActive()
    // Activate all
    const results = await Promise.allSettled(
      activeExtensions.map((ext: Extension) => this.activateExtension(ext))
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Extension activation failed:', result.reason)
      }
    }
  }

  /**
   * Install a new extension.
   * @param {Array.<installOptions | string>} extensions A list of NPM specifiers, or installation configuration objects.
   * @returns {Promise.<Array.<Extension> | false>} extension as defined by the main process. Has property cancelled set to true if installation was cancelled in the main process.
   */
  async install(extensions: ExtensionManifest[]) {
    if (typeof window === 'undefined') {
      return
    }
    const res = await getServiceHub().core().installExtension(extensions)
    return Promise.all(
      res.map(async (ext: ExtensionManifest) => {
        const extension = new Extension(ext.url, ext.name)
        await this.activateExtension(extension)
        return extension
      })
    )
  }

  /**
   * Uninstall provided extensions
   * @param {Array.<string>} extensions List of names of extensions to uninstall.
   * @param {boolean} reload Whether to reload all renderers after updating the extensions.
   * @returns {Promise.<boolean>} Whether uninstalling the extensions was successful.
   */
  async uninstall(extensions: string[], reload = true) {
    if (typeof window === 'undefined') {
      return
    }
    return await getServiceHub().core().uninstallExtension(extensions, reload)
  }

  /**
   * Shared instance of ExtensionManager.
   */
  static getInstance() {
    const core = ensureCoreBridge({ withApi: true, withEvents: true })
    if (!core.extensionManager) {
      core.extensionManager = new ExtensionManager()
    }
    return core.extensionManager
  }
}
