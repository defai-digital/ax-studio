import { invoke } from '@tauri-apps/api/core'

// Blocklist of hostnames that should not be scraped (internal services, localhost, etc.)
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '10.0.0.0/8', // Private networks
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16', // Link-local
  'fc00::/7', // Unique local addresses (IPv6)
])

function isValidScrapeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Only allow HTTPS
    if (parsed.protocol !== 'https:') {
      return false
    }
    // Check against blocklist
    if (BLOCKED_HOSTNAMES.has(parsed.hostname)) {
      return false
    }
    // Check for IP addresses in blocked ranges
    const hostname = parsed.hostname
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      const parts = hostname.split('.').map(Number)
      // Check private IP ranges
      if (
        (parts[0] === 10) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168) ||
        (parts[0] === 169 && parts[1] === 254)
      ) {
        return false
      }
    }
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
  return Promise.race([
    invoke<string>('scrape_url', { url }),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('scrape timeout')), ms)
    ),
    new Promise<string>((_, reject) => {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  ]).catch(() => '')
}
