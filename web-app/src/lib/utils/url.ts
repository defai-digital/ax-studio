import { invoke } from '@tauri-apps/api/core'

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function openUrl(url: string) {
  invoke('plugin:opener|open_url', { url }).catch(console.warn)
}
