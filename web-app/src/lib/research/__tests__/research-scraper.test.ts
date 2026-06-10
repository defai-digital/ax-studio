import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

const mockInvoke = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: mockInvoke }) }),
}))

import { scrapeWithTimeout } from '../research-scraper'

describe('scrapeWithTimeout', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockInvoke.mockReset()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it('should return empty string when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await scrapeWithTimeout('https://example.com', controller.signal)
    expect(result).toBe('')
  })

  it('should call invoke with scrape_url command', async () => {
    mockInvoke.mockResolvedValueOnce('<html>content</html>')
    const controller = new AbortController()

    const result = await scrapeWithTimeout('https://example.com', controller.signal)
    expect(result).toBe('<html>content</html>')
    expect(mockInvoke).toHaveBeenCalledWith('scrape_url', { url: 'https://example.com' })
  })

  it('should return empty string on invoke error', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Network error'))
    const controller = new AbortController()

    const result = await scrapeWithTimeout('https://example.com', controller.signal)
    expect(result).toBe('')
  })

  it('should return empty string on timeout', async () => {
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
      mockInvoke.mockResolvedValueOnce('<html>content</html>')
      const controller = new AbortController()

      const result = await scrapeWithTimeout('https://example.com', controller.signal)
      expect(result).toBe('<html>content</html>')
    })
  })
})
