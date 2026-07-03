import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriOpenerService } from '../opener/tauri'

const mocks = vi.hoisted(() => ({
  revealItemInDir: vi.fn(),
  openUrl: vi.fn(),
  tryAxBiLiveNavigation: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: mocks.revealItemInDir,
  openUrl: mocks.openUrl,
}))

vi.mock('@/lib/ax-bi/live-navigation', () => ({
  tryAxBiLiveNavigation: mocks.tryAxBiLiveNavigation,
}))

describe('TauriOpenerService', () => {
  let service: TauriOpenerService

  beforeEach(() => {
    service = new TauriOpenerService()
    vi.clearAllMocks()
  })

  it('reveals an item in the native file manager', async () => {
    mocks.revealItemInDir.mockResolvedValue(undefined)
    await service.revealItemInDir('/Users/devop/Downloads/file.txt')
    expect(mocks.revealItemInDir).toHaveBeenCalledWith('/Users/devop/Downloads/file.txt')
  })

  it('propagates revealItemInDir errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.revealItemInDir.mockRejectedValue(new Error('access denied'))
    await expect(service.revealItemInDir('/locked')).rejects.toThrow('access denied')
    errorSpy.mockRestore()
  })

  it('opens a URL in the system browser', async () => {
    mocks.tryAxBiLiveNavigation.mockResolvedValue(false)
    mocks.openUrl.mockResolvedValue(undefined)
    await service.openUrl('https://example.com')
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('does not open a browser tab when AX-BI live navigation acknowledges', async () => {
    mocks.tryAxBiLiveNavigation.mockResolvedValue(true)
    await service.openUrl('http://127.0.0.1:8088/explore/p/abc/')
    expect(mocks.openUrl).not.toHaveBeenCalled()
  })

  it('swallows openUrl errors (fire-and-forget semantics)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.tryAxBiLiveNavigation.mockResolvedValue(false)
    mocks.openUrl.mockRejectedValue(new Error('no browser'))
    await expect(service.openUrl('https://example.com')).resolves.toBeUndefined()
    warnSpy.mockRestore()
  })
})
