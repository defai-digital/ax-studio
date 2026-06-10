import { getServiceHub } from '@/hooks/useServiceHub'

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function openUrl(url: string) {
  getServiceHub().opener().openUrl(url)
}
