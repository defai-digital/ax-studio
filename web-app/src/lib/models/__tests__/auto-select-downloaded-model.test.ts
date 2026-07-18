import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAutoSelectDownloadedModelState,
  autoSelectDownloadedModel,
} from '../auto-select-downloaded-model'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useThreads } from '@/hooks/threads/useThreads'
import { getLastUsedModel } from '@/lib/utils/getModelToStart'

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({
    path: () => ({
      sep: () => '/',
    }),
  })),
}))

const llamacppProvider = (models: { id: string }[]): ModelProvider => ({
  provider: 'llamacpp',
  active: true,
  settings: [],
  models: models.map((model) => ({ id: model.id })),
})

const resetStores = () => {
  useModelProvider.setState({
    providers: [],
    selectedProvider: '',
    selectedModel: null,
    deletedModels: [],
  })
  useThreads.setState({
    threads: {},
    currentThreadId: undefined,
  })
  localStorage.clear()
  __resetAutoSelectDownloadedModelState()
}

describe('autoSelectDownloadedModel', () => {
  beforeEach(() => {
    resetStores()
  })

  it('selects the downloaded model once it lands in the provider store', async () => {
    useModelProvider.setState({ providers: [llamacppProvider([])] })

    const resultPromise = autoSelectDownloadedModel('new-model')

    // Simulate the provider refresh triggered by onModelImported.
    useModelProvider
      .getState()
      .setProviders([llamacppProvider([{ id: 'new-model' }])], '/')

    const result = await resultPromise

    expect(result).toMatchObject({
      status: 'selected',
      showFirstModelToast: true,
      modelId: 'new-model',
      providerId: 'llamacpp',
    })

    const state = useModelProvider.getState()
    expect(state.selectedProvider).toBe('llamacpp')
    expect(state.selectedModel?.id).toBe('new-model')

    // Same last-used mechanism the composer dropdown uses.
    expect(getLastUsedModel()).toEqual({
      provider: 'llamacpp',
      model: 'new-model',
    })
  })

  it('does not flag the toast when the user already has local models', async () => {
    useModelProvider.setState({
      providers: [llamacppProvider([{ id: 'existing-model' }])],
    })

    const resultPromise = autoSelectDownloadedModel('second-model')
    useModelProvider
      .getState()
      .setProviders(
        [llamacppProvider([{ id: 'existing-model' }, { id: 'second-model' }])],
        '/'
      )

    const result = await resultPromise

    expect(result.status).toBe('selected')
    expect(result.showFirstModelToast).toBe(false)
    expect(useModelProvider.getState().selectedModel?.id).toBe('second-model')
  })

  it('shows the first-model toast only once per session', async () => {
    useModelProvider.setState({ providers: [llamacppProvider([])] })

    const firstPromise = autoSelectDownloadedModel('model-one')
    useModelProvider
      .getState()
      .setProviders([llamacppProvider([{ id: 'model-one' }])], '/')
    const first = await firstPromise
    expect(first.showFirstModelToast).toBe(true)

    // A concurrent first download completing before/around the same refresh
    // must not trigger a second toast.
    useModelProvider.setState({ providers: [llamacppProvider([])] })
    const secondPromise = autoSelectDownloadedModel('model-two')
    useModelProvider
      .getState()
      .setProviders([llamacppProvider([{ id: 'model-two' }])], '/')
    const second = await secondPromise
    expect(second.showFirstModelToast).toBe(false)
  })

  it('keeps the current thread model but still records last-used', async () => {
    useModelProvider.setState({
      providers: [llamacppProvider([{ id: 'thread-model' }])],
    })
    useModelProvider
      .getState()
      .selectModelProvider('llamacpp', 'thread-model')
    useThreads.setState({ currentThreadId: 'thread-1' })

    const resultPromise = autoSelectDownloadedModel('downloaded-model')
    useModelProvider
      .getState()
      .setProviders(
        [llamacppProvider([{ id: 'thread-model' }, { id: 'downloaded-model' }])],
        '/'
      )

    const result = await resultPromise

    expect(result.status).toBe('thread-preserved')
    expect(result.showFirstModelToast).toBe(false)

    // The open thread's selection is untouched…
    expect(useModelProvider.getState().selectedModel?.id).toBe('thread-model')
    // …but the next new chat falls back to the downloaded model.
    expect(getLastUsedModel()).toEqual({
      provider: 'llamacpp',
      model: 'downloaded-model',
    })
  })

  it('reports unavailable when the model never registers', async () => {
    useModelProvider.setState({ providers: [llamacppProvider([])] })

    const result = await autoSelectDownloadedModel('ghost-model', {
      timeoutMs: 20,
    })

    expect(result.status).toBe('unavailable')
    expect(result.showFirstModelToast).toBe(false)
    expect(useModelProvider.getState().selectedModel).toBeNull()
    expect(getLastUsedModel()).toBeNull()
  })

  it('collapses the duplicate success events fired per download', async () => {
    useModelProvider.setState({
      providers: [llamacppProvider([{ id: 'dup-model' }])],
    })

    const [first, second] = await Promise.all([
      autoSelectDownloadedModel('dup-model'),
      autoSelectDownloadedModel('dup-model'),
    ])

    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual(['duplicate', 'selected'])
  })
})
