import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: mockInvoke,
}))

import {
  ensureAxEngineSidecarModel,
  listAxEngineSidecarModels,
  resolveAxEngineModelPath,
  sessionFromAxEngineStatus,
  unloadAxEngineSidecarModel,
} from '../sidecar-lifecycle'

describe('ax-engine sidecar lifecycle helpers', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('resolveAxEngineModelPath uses mlx_resolve_model_dir when available', async () => {
    mockInvoke.mockResolvedValueOnce('/cache/models/qwen')
    await expect(resolveAxEngineModelPath('org/qwen')).resolves.toBe(
      '/cache/models/qwen'
    )
    expect(mockInvoke).toHaveBeenCalledWith('mlx_resolve_model_dir', {
      modelId: 'org/qwen',
      model_id: 'org/qwen',
    })
  })

  it('resolveAxEngineModelPath falls back to the model id', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not found'))
    await expect(resolveAxEngineModelPath('ax-qwen3.6-27b')).resolves.toBe(
      'ax-qwen3.6-27b'
    )
  })

  it('ensureAxEngineSidecarModel calls ax_engine_ensure and not mlx_load_model', async () => {
    mockInvoke
      .mockResolvedValueOnce('/path/to/model') // resolve
      .mockResolvedValueOnce({
        phase: 'ready',
        baseURL: 'http://127.0.0.1:31418/v1',
        apiKey: 'local',
        models: ['m1'],
        port: 31418,
        pid: 42,
      })

    const { status, modelPath } = await ensureAxEngineSidecarModel('m1')
    expect(modelPath).toBe('/path/to/model')
    expect(status.phase).toBe('ready')
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual([
      'mlx_resolve_model_dir',
      'ax_engine_ensure',
    ])
    expect(mockInvoke.mock.calls.map((c) => c[0])).not.toContain(
      'mlx_load_model'
    )
  })

  it('ensureAxEngineSidecarModel throws on non-ready phases', async () => {
    mockInvoke
      .mockResolvedValueOnce('m1')
      .mockResolvedValueOnce({ phase: 'missing_dependency', detail: 'no binary' })

    await expect(ensureAxEngineSidecarModel('m1')).rejects.toThrow('no binary')
  })

  it('sessionFromAxEngineStatus maps status fields', () => {
    expect(
      sessionFromAxEngineStatus('m1', '/p', {
        pid: 9,
        port: 31418,
        apiKey: 'local',
      })
    ).toEqual({
      pid: 9,
      port: 31418,
      model_id: 'm1',
      model_path: '/p',
      is_embedding: false,
      api_key: 'local',
    })
  })

  it('unloadAxEngineSidecarModel uses ax_engine_unload_model', async () => {
    mockInvoke.mockResolvedValueOnce({})
    await expect(unloadAxEngineSidecarModel('m1')).resolves.toEqual({
      success: true,
    })
    expect(mockInvoke).toHaveBeenCalledWith('ax_engine_unload_model', {
      modelId: 'm1',
      model_id: 'm1',
    })
  })

  it('listAxEngineSidecarModels reads ax_engine_status.models', async () => {
    mockInvoke.mockResolvedValueOnce({ models: ['a', 'b'] })
    await expect(listAxEngineSidecarModels()).resolves.toEqual(['a', 'b'])
    expect(mockInvoke).toHaveBeenCalledWith('ax_engine_status')
  })
})
