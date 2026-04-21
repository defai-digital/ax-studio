import { invoke } from '@tauri-apps/api/core'

// Blocklist of hostnames that should not be scraped (internal services, localhost, etc.)
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
])

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return false
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 127) ||
    (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0)
  )
}

function isPrivateIPv6(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd')) return true
  const v4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(h)
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1])
  return false
}

function isValidScrapeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname
    if (BLOCKED_HOSTNAMES.has(hostname)) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && isPrivateIPv4(hostname)) return false
    if (hostname.includes(':') && isPrivateIPv6(hostname)) return false
    return true
  } catch {
    return false
  }
}

export async function scrapeWithTimeout(url: string, signal: AbortSignal, ms = 8000): Promise<string> {
  if (!isValidScrapeUrl(url)) {
    throw new Error('Invalid URL: only HTTPS URLs to external hosts are allowed')
  }
  if (signal.aborted) return ''

  let timer: ReturnType<typeof setTimeout>
  let onAbort: (() => void) | undefined

  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => reject(new Error('scrape timeout')), ms)
  })

  const abort = new Promise<string>((_, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([
      invoke<string>('scrape_url', { url }),
      timeout,
      abort,
    ])
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    if (err instanceof Error && err.message !== 'scrape timeout') {
      console.warn(`[research] scrape failed for ${url}:`, err.message)
    }
    return ''
  } finally {
    clearTimeout(timer!)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
