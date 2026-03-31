import { describe, it, expect, vi } from 'vitest'
import { scrapeWithTimeout } from '../research-scraper'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

describe('scrapeWithTimeout', () => {
  it('should return empty string when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await scrapeWithTimeout('https://example.com', controller.signal)
    expect(result).toBe('')
  })

  it('should call invoke with scrape_url command', async () => {
    const mockInvoke = vi.mocked(invoke)
    mockInvoke.mockResolvedValueOnce('<html>content</html>')
    const controller = new AbortController()

    const result = await scrapeWithTimeout('https://example.com', controller.signal)
    expect(result).toBe('<html>content</html>')
    expect(mockInvoke).toHaveBeenCalledWith('scrape_url', { url: 'https://example.com' })
  })

  it('should return empty string on invoke error', async () => {
    const mockInvoke = vi.mocked(invoke)
    mockInvoke.mockRejectedValueOnce(new Error('Network error'))
    const controller = new AbortController()

    const result = await scrapeWithTimeout('https://example.com', controller.signal)
    expect(result).toBe('')
  })

  it('should return empty string on timeout', async () => {
    const mockInvoke = vi.mocked(invoke)
    mockInvoke.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 20000)),
    )
    const controller = new AbortController()

    const result = await scrapeWithTimeout('https://example.com', controller.signal, 10)
    expect(result).toBe('')
  })

  describe('URL validation', () => {
    it('should throw error for invalid URL', async () => {
      const controller = new AbortController()
      await expect(scrapeWithTimeout('not-a-url', controller.signal)).rejects.toThrow(
        'Invalid URL: only HTTPS URLs to external hosts are allowed'
      )
    })

    it('should throw error for HTTP URL', async () => {
      const controller = new AbortController()
      await expect(scrapeWithTimeout('http://example.com', controller.signal)).rejects.toThrow(
        'Invalid URL: only HTTPS URLs to external hosts are allowed'
      )
    })

    it('should throw error for localhost', async () => {
      const controller = new AbortController()
      await expect(scrapeWithTimeout('https://localhost', controller.signal)).rejects.toThrow(
        'Invalid URL: only HTTPS URLs to external hosts are allowed'
      )
    })

    it('should throw error for 127.0.0.1', async () => {
      const controller = new AbortController()
      await expect(scrapeWithTimeout('https://127.0.0.1', controller.signal)).rejects.toThrow(
        'Invalid URL: only HTTPS URLs to external hosts are allowed'
      )
    })

    it('should throw error for private IP 192.168.1.1', async () => {
      const controller = new AbortController()
      await expect(scrapeWithTimeout('https://192.168.1.1', controller.signal)).rejects.toThrow(
        'Invalid URL: only HTTPS URLs to external hosts are allowed'
      )
    })

    it('should accept valid HTTPS URL', async () => {
      const mockInvoke = vi.mocked(invoke)
      mockInvoke.mockResolvedValueOnce('<html>content</html>')
      const controller = new AbortController()

      const result = await scrapeWithTimeout('https://example.com', controller.signal)
      expect(result).toBe('<html>content</html>')
    })
  })
})
