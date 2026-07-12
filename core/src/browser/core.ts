import { AppEvent } from '../types/api'
import { events } from './events'

/**
 * Validates that a URL has a safe protocol (http or https).
 * @param url - The URL to validate
 * @throws Error if the URL has an unsafe protocol
 */
const PRIVATE_HOSTNAME_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  // Unique local (fc00::/7 → fc00–fdff) and link-local (fe80::/10 → fe80–febf)
  /^f[cd][0-9a-f]{2}:/i,
  /^fe[89ab][0-9a-f]:/i,
  /^::1$/i,
  /^localhost$/i,
  /^$/,
]

/** Strip IPv6 brackets that some URL parsers keep on `hostname`. */
const unwrapIpv6Hostname = (hostname: string): string => {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

/**
 * Expand IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:HHHH:LLLL) to dotted IPv4.
 * Returns null when the host is not an IPv4-mapped address.
 */
const ipv4FromMappedIpv6 = (hostname: string): string | null => {
  const dotted = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (dotted) return dotted[1]

  const hex = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!hex) return null

  const hi = Number.parseInt(hex[1], 16)
  const lo = Number.parseInt(hex[2], 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null

  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}

const isPrivateHostname = (hostname: string): boolean => {
  if (!hostname) return true

  const normalized = unwrapIpv6Hostname(hostname.trim())
  if (!normalized) return true

  if (PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 / ::ffff:7f00:1)
  const mappedIpv4 = ipv4FromMappedIpv6(normalized)
  if (mappedIpv4) {
    return PRIVATE_HOSTNAME_PATTERNS.some((pattern) => pattern.test(mappedIpv4))
  }

  return false
}

export const validateUrlProtocol = (url: string): void => {
  const trimmed = url.trim()
  try {
    const parsedUrl = new URL(trimmed)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(
        `Unsafe URL protocol: ${parsedUrl.protocol}. Only http and https are allowed.`
      )
    }
    if (isPrivateHostname(parsedUrl.hostname)) {
      throw new Error(
        `URLs pointing to private/internal networks are not allowed: ${parsedUrl.hostname}`
      )
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Invalid URL format: ${trimmed}`)
    }
    throw error
  }
}

const getCoreApi = () => {
  const api = globalThis.core?.api
  if (!api) {
    throw new Error('Core API bridge is not available')
  }
  return api
}

export { getCoreApi }

/**
 * Gets the application data folder path.
 *
 * @returns {Promise<string>} A Promise that resolves with the application data folder path.
 */
const getAppDataFolderPath = (): Promise<string> =>
  getCoreApi().getAppDataFolderPath() as Promise<string>

/**
 * Opens the file explorer at a specific path.
 * @param {string} path - The path to open in the file explorer.
 * @returns {Promise<any>} A promise that resolves when the file explorer is opened.
 */
const openFileExplorer: (path: string) => Promise<void> = (path) =>
  getCoreApi().openFileExplorer({ path }) as Promise<void>

/**
 * Joins multiple paths together.
 * @param paths - The paths to join.
 * @returns {Promise<string>} A promise that resolves with the joined path.
 */
const joinPath: (args: string[]) => Promise<string> = (args) =>
  getCoreApi().joinPath({ args }) as Promise<string>

/**
 * Get dirname of a file path.
 * @param path - The file path to retrieve dirname.
 * @returns {Promise<string>} A promise that resolves the dirname.
 */
const dirName: (path: string) => Promise<string> = (path) =>
  getCoreApi().dirName({ args: [path] }) as Promise<string>

/**
 * Retrieve the basename from an url.
 * @param path - The path to retrieve.
 * @returns {Promise<string>} A promise that resolves with the basename.
 */
const baseName: (path: string) => Promise<string> = (path) =>
  getCoreApi().baseName({ args: [path] }) as Promise<string>

/**
 * Opens an external URL in the default web browser.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<any>} - A promise that resolves when the URL has been successfully opened.
 */
const openExternalUrl: (url: string) => Promise<void> = (url) => {
  validateUrlProtocol(url)
  return getCoreApi().openExternalUrl(url) as Promise<void>
}

/**
 * Gets the resource path of the application.
 *
 * @returns {Promise<string>} - A promise that resolves with the resource path.
 */
const getResourcePath: () => Promise<string> = () =>
  getCoreApi().getResourcePath() as Promise<string>

/**
 * Gets the user's home path.
 * @returns return user's home path
 */
const getUserHomePath = (): Promise<string> => getCoreApi().getUserHomePath() as Promise<string>

/**
 * Log to file from browser processes.
 *
 * @param message - Message to log.
 */
const log: (message: string, fileName?: string) => void = (message, fileName) => {
  const payload = fileName ? { message, fileName } : { message }
  void getCoreApi().log(payload)
}

/**
 * Check whether the path is a subdirectory of another path.
 *
 * @param from - The path to check.
 * @param to - The path to check against.
 *
 * @returns {Promise<boolean>} - A promise that resolves with a boolean indicating whether the path is a subdirectory.
 */
const isSubdirectory: (from: string, to: string) => Promise<boolean> = (from: string, to: string) =>
  getCoreApi().isSubdirectory({ from, to }) as Promise<boolean>

/**
 * Show toast message from browser processes.
 * @param title
 * @param message
 * @returns
 */
const showToast: (title: string, message: string) => void = (title, message) =>
  events.emit(AppEvent.onShowToast, { title, message })

/**
 * Functions exports
 */
export {
  getAppDataFolderPath,
  openFileExplorer,
  getResourcePath,
  joinPath,
  openExternalUrl,
  baseName,
  log,
  isSubdirectory,
  getUserHomePath,
  showToast,
  dirName,
}
