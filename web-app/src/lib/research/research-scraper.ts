import { invoke } from '@tauri-apps/api/core'

export async function scrapeWithTimeout(url: string, signal: AbortSignal, ms = 8000): Promise<string> {
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
