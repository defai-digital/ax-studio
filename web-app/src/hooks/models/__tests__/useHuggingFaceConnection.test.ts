import { beforeEach, describe, expect, it, vi } from 'vitest'

const tokenMocks = vi.hoisted(() => ({
  clearStoredHuggingFaceToken: vi.fn(),
  normalizeHuggingFaceToken: vi.fn((value: string) => value.trim()),
  readStoredHuggingFaceToken: vi.fn(),
  storeHuggingFaceToken: vi.fn(),
  validateHuggingFaceToken: vi.fn(),
}))

vi.mock('@/lib/huggingface/token-storage', () => tokenMocks)

import { useHuggingFaceConnection } from '../useHuggingFaceConnection'

describe('useHuggingFaceConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokenMocks.readStoredHuggingFaceToken.mockResolvedValue(null)
    tokenMocks.storeHuggingFaceToken.mockResolvedValue('hf_connected')
    tokenMocks.validateHuggingFaceToken.mockResolvedValue({ name: 'ax-user' })
    tokenMocks.clearStoredHuggingFaceToken.mockResolvedValue(undefined)
    useHuggingFaceConnection.setState(
      useHuggingFaceConnection.getInitialState(),
      true
    )
  })

  it('hydrates a saved token once', async () => {
    tokenMocks.readStoredHuggingFaceToken.mockResolvedValue('hf_saved')

    await Promise.all([
      useHuggingFaceConnection.getState().initialize(),
      useHuggingFaceConnection.getState().initialize(),
    ])

    expect(tokenMocks.readStoredHuggingFaceToken).toHaveBeenCalledTimes(1)
    expect(useHuggingFaceConnection.getState()).toMatchObject({
      token: 'hf_saved',
      initialized: true,
      isLoading: false,
    })
  })

  it('validates before saving a connection', async () => {
    await useHuggingFaceConnection.getState().connect(' hf_connected ')

    expect(tokenMocks.validateHuggingFaceToken).toHaveBeenCalledWith(
      'hf_connected',
      undefined
    )
    expect(tokenMocks.storeHuggingFaceToken).toHaveBeenCalledWith(
      'hf_connected'
    )
    expect(useHuggingFaceConnection.getState()).toMatchObject({
      token: 'hf_connected',
      accountName: 'ax-user',
      initialized: true,
      isConnecting: false,
      error: undefined,
    })
  })

  it('keeps an existing connection when replacement validation fails', async () => {
    useHuggingFaceConnection.setState({
      token: 'hf_existing',
      initialized: true,
    })
    tokenMocks.validateHuggingFaceToken.mockRejectedValue(
      new Error('Invalid token')
    )

    await expect(
      useHuggingFaceConnection.getState().connect('hf_invalid')
    ).rejects.toThrow('Invalid token')

    expect(tokenMocks.storeHuggingFaceToken).not.toHaveBeenCalled()
    expect(useHuggingFaceConnection.getState()).toMatchObject({
      token: 'hf_existing',
      isConnecting: false,
      error: 'Invalid token',
    })
  })

  it('disconnects and removes the secure token', async () => {
    useHuggingFaceConnection.setState({
      token: 'hf_existing',
      accountName: 'ax-user',
      initialized: true,
    })

    await useHuggingFaceConnection.getState().disconnect()

    expect(tokenMocks.clearStoredHuggingFaceToken).toHaveBeenCalledOnce()
    expect(useHuggingFaceConnection.getState()).toMatchObject({
      token: undefined,
      accountName: undefined,
      initialized: true,
      isConnecting: false,
    })
  })

  it('controls the global connection dialog', () => {
    useHuggingFaceConnection.getState().setDialogOpen(true)
    expect(useHuggingFaceConnection.getState().dialogOpen).toBe(true)

    useHuggingFaceConnection.getState().setDialogOpen(false)
    expect(useHuggingFaceConnection.getState().dialogOpen).toBe(false)
  })
})
