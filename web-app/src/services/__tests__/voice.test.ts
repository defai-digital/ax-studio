import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

async function createService() {
  const { TauriVoiceService } = await import('../voice/tauri')
  return new TauriVoiceService()
}

describe('TauriVoiceService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('is available on the desktop shell', async () => {
    const service = await createService()
    expect(service.isAvailable()).toBe(true)
  })

  it('starts recording with the selected model', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue(undefined)

    await service.startRecording('base.en')

    expect(mocks.invoke).toHaveBeenCalledWith('voice_start_recording', {
      model: 'base.en',
    })
  })

  it('stops recording and returns the transcript', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue('hello world')

    await expect(service.stopRecording()).resolves.toBe('hello world')
    expect(mocks.invoke).toHaveBeenCalledWith('voice_stop_recording')
  })

  it('cancels recording', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue(undefined)

    await service.cancelRecording()

    expect(mocks.invoke).toHaveBeenCalledWith('voice_cancel_recording')
  })

  it('returns the voice status payload', async () => {
    const service = await createService()
    const status = { state: 'recording', modelDownloaded: true, audioLevel: 0.4 }
    mocks.invoke.mockResolvedValue(status)

    await expect(service.getStatus('small.en')).resolves.toEqual(status)
    expect(mocks.invoke).toHaveBeenCalledWith('voice_get_status', {
      model: 'small.en',
    })
  })

  it('downloads a model', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue(undefined)

    await service.downloadModel('small.en')

    expect(mocks.invoke).toHaveBeenCalledWith('voice_download_model', {
      model: 'small.en',
    })
  })

  it('cancels a model download via the downloads task id', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue(undefined)

    await service.cancelModelDownload('base.en')

    expect(mocks.invoke).toHaveBeenCalledWith('cancel_download_task', {
      taskId: 'voice-model-base-en',
    })
  })

  it('ignores a missing download task on cancel', async () => {
    const service = await createService()
    mocks.invoke.mockRejectedValue(new Error('No download task: voice-model-base-en'))

    await expect(service.cancelModelDownload('base.en')).resolves.toBeUndefined()
  })

  it('deletes a model', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue(undefined)

    await service.deleteModel('base.en')

    expect(mocks.invoke).toHaveBeenCalledWith('voice_delete_model', {
      model: 'base.en',
    })
  })

  it('propagates typed voice errors untouched', async () => {
    const service = await createService()
    const voiceError = {
      kind: 'model-not-downloaded',
      message: "voice model 'base.en' is not downloaded",
    }
    mocks.invoke.mockRejectedValue(voiceError)

    await expect(service.startRecording('base.en')).rejects.toEqual(voiceError)
  })
})

describe('voice service types helpers', () => {
  it('builds download task ids without dots', async () => {
    const { voiceModelDownloadTaskId, voiceModelDownloadEvent } = await import(
      '../voice/types'
    )
    expect(voiceModelDownloadTaskId('base.en')).toBe('voice-model-base-en')
    expect(voiceModelDownloadTaskId('small.en')).toBe('voice-model-small-en')
    expect(voiceModelDownloadEvent('base.en')).toBe(
      'download-voice-model-base-en'
    )
  })

  it('detects voice error shapes', async () => {
    const { isVoiceError } = await import('../voice/types')
    expect(isVoiceError({ kind: 'not-recording' })).toBe(true)
    expect(isVoiceError(new Error('nope'))).toBe(false)
    expect(isVoiceError('not-recording')).toBe(false)
    expect(isVoiceError(null)).toBe(false)
  })
})

describe('DefaultVoiceService', () => {
  it('is unavailable and a full no-op', async () => {
    const { DefaultVoiceService } = await import('../voice/default')
    const service = new DefaultVoiceService()

    expect(service.isAvailable()).toBe(false)
    await expect(service.startRecording('base.en')).resolves.toBeUndefined()
    await expect(service.stopRecording()).resolves.toBe('')
    await expect(service.cancelRecording()).resolves.toBeUndefined()
    await expect(service.getStatus('base.en')).resolves.toEqual({
      state: 'idle',
      modelDownloaded: false,
      audioLevel: 0,
    })
    await expect(service.downloadModel('base.en')).resolves.toBeUndefined()
    await expect(service.cancelModelDownload('base.en')).resolves.toBeUndefined()
    await expect(service.deleteModel('base.en')).resolves.toBeUndefined()
  })
})
