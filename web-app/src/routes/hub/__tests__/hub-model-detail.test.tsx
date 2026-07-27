import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { Route } from '../$modelId'

const mocks = vi.hoisted(() => {
  const modelsService = {
    convertHfRepoToCatalogModel: vi.fn(),
    fetchHuggingFaceRepo: vi.fn(),
    isModelSupported: vi.fn(),
    pullModelWithMetadata: vi.fn(),
  }

  return {
    ...modelsService,
    serviceHub: {
      models: () => modelsService,
    },
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

// Mock dependencies
vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/hooks/models/useModelSources', () => ({
  useModelSources: () => ({
    sources: [],
    fetchSources: vi.fn(),
  }),
}))

vi.mock('@/hooks/models/useHuggingFaceConnection', () => ({
  useHuggingFaceConnection: (
    selector: (state: { token?: string }) => unknown
  ) => selector({ token: undefined }),
}))

vi.mock('@/containers/HuggingFaceConnectionDialog', () => ({
  HuggingFaceConnectionButton: () => <button>Hugging Face connection</button>,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => mocks.serviceHub,
}))

vi.mock('@/hooks/models/useDownloadStore', () => ({
  toDownloadProcesses: vi.fn(
    (
      downloads: Record<
        string,
        { name: string; progress: number; current: number; total: number }
      >
    ) =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      }))
  ),
  useDownloadStore: () => ({
    downloads: {},
    localDownloadingModels: new Set(),
    addLocalDownloadingModel: vi.fn(),
  }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn().mockImplementation((selector) =>
    selector({
      getProviderByName: vi.fn().mockReturnValue({
        models: [],
      }),
    })
  ),
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/containers/ModelInfoHoverCard', () => ({
  ModelInfoHoverCard: () => <div data-testid="model-info-hover-card" />,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: () => <div data-testid="progress" />,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}))

vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    home: '/home',
    hub: {
      index: '/hub',
    },
  },
}))

vi.mock('@/constants/models', () => ({
  DEFAULT_MODEL_QUANTIZATIONS: [],
}))

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router')
  return {
    ...actual,
    useParams: vi.fn(),
    useNavigate: vi.fn().mockReturnValue(vi.fn()),
    useSearch: vi.fn().mockReturnValue({}),
    createFileRoute: vi
      .fn()
      .mockImplementation((path: string) =>
        vi.fn().mockImplementation((config: any) => ({ ...config, id: path }))
      ),
  }
})

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}))

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <div />,
  Eye: () => <div />,
  Wrench: () => <div />,
  Calendar: () => <div />,
  Download: () => <div />,
  ExternalLink: () => <div />,
  HardDrive: () => <div />,
}))

vi.mock('@/lib/models', () => ({
  extractModelName: vi.fn(),
  extractDescription: vi.fn(),
  getPreferredMmprojPath: vi.fn(
    (models?: Array<{ path: string }>) => models?.[0]?.path
  ),
}))

vi.mock('@/lib/utils', () => ({
  sanitizeModelId: vi.fn((id) =>
    id.replace(/[^a-zA-Z0-9/_\-.]/g, '').replace(/\./g, '_')
  ),
}))

import { useParams } from '@tanstack/react-router'
import { sanitizeModelId } from '@/lib/utils'
import { useHardware } from '@/hooks/settings/useHardware'

const emptyHardwareData = {
  cpu: { arch: '', core_count: 0, extensions: [], name: '', usage: 0 },
  gpus: [],
  os_type: '',
  os_name: '',
  total_memory: 0,
}

describe('Hub Model Detail Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchHuggingFaceRepo.mockResolvedValue(null)
    mocks.isModelSupported.mockResolvedValue('GREEN')
    useHardware.setState({ hardwareData: emptyHardwareData })
  })

  it('should use raw modelId parameter for catalog lookup', () => {
    const mockModelId = 'user/model.v2'
    ;(useParams as any).mockReturnValue({ modelId: mockModelId })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(sanitizeModelId).not.toHaveBeenCalledWith(mockModelId)
    expect(screen.getByText('Model not found')).toBeInTheDocument()
  })

  it('ignores delayed repo lookup results after unmount', async () => {
    const repoLookup = deferred<unknown>()
    mocks.fetchHuggingFaceRepo.mockReturnValue(repoLookup.promise)
    ;(useParams as any).mockReturnValue({ modelId: 'user/model' })

    const Component = Route.component as React.ComponentType
    const { unmount } = render(<Component />)

    await waitFor(() => {
      expect(mocks.fetchHuggingFaceRepo).toHaveBeenCalledTimes(1)
    })
    const signal = mocks.fetchHuggingFaceRepo.mock.calls[0][2] as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)

    await act(async () => {
      repoLookup.resolve({ id: 'repo-result' })
      await repoLookup.promise
    })

    expect(mocks.convertHfRepoToCatalogModel).not.toHaveBeenCalled()
  })

  it('clears stale repo data when a new route lookup has no result', async () => {
    mocks.fetchHuggingFaceRepo.mockResolvedValueOnce({ id: 'first-repo' })
    mocks.convertHfRepoToCatalogModel.mockReturnValue({
      model_name: 'first-model',
      developer: 'org',
      downloads: 0,
      quants: [],
    })
    ;(useParams as any).mockReturnValue({ modelId: 'first-model' })

    const Component = Route.component as React.ComponentType
    const { rerender } = render(<Component />)

    expect(await screen.findByText('first-model')).toBeInTheDocument()
    ;(useParams as any).mockReturnValue({ modelId: 'missing-model' })
    rerender(<Component />)

    await waitFor(() => {
      expect(mocks.fetchHuggingFaceRepo).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('first-model')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Model not found')).toBeInTheDocument()
  })

  it('should render "Model not found" when no model data', () => {
    ;(useParams as any).mockReturnValue({ modelId: 'valid/model' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Model not found')).toBeInTheDocument()
  })

  it('shows memory estimate and label per variant when hardware info is available', async () => {
    useHardware.setState({
      hardwareData: { ...emptyHardwareData, total_memory: 16 * 1024 },
    })
    mocks.fetchHuggingFaceRepo.mockResolvedValueOnce({ id: 'repo' })
    mocks.convertHfRepoToCatalogModel.mockReturnValue({
      model_name: 'user/model',
      developer: 'user',
      downloads: 0,
      quants: [
        {
          model_id: 'model-Q4_K_M-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q4_K_M.gguf',
          file_size: '4.0 GB',
        },
        {
          model_id: 'model-Q8_0-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q8_0.gguf',
          file_size: '14.0 GB',
        },
      ],
    })
    ;(useParams as any).mockReturnValue({ modelId: 'user/model' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(await screen.findByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText('Exceeds your RAM')).toBeInTheDocument()
    expect(screen.getByText('≈ 4.8 GB')).toBeInTheDocument()
    expect(screen.getByText('≈ 17 GB')).toBeInTheDocument()
  })

  it('degrades to file size only when hardware info is unavailable', async () => {
    mocks.fetchHuggingFaceRepo.mockResolvedValueOnce({ id: 'repo' })
    mocks.convertHfRepoToCatalogModel.mockReturnValue({
      model_name: 'user/model',
      developer: 'user',
      downloads: 0,
      quants: [
        {
          model_id: 'model-Q4_K_M-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q4_K_M.gguf',
          file_size: '4.0 GB',
        },
      ],
    })
    ;(useParams as any).mockReturnValue({ modelId: 'user/model' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(await screen.findByText('4.0 GB')).toBeInTheDocument()
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
    // S2.4 — no pre-selection or trade-off copy without hardware info.
    expect(screen.queryByText('Best for you')).not.toBeInTheDocument()
    expect(screen.queryByText(/GB RAM/)).not.toBeInTheDocument()
  })

  it('pre-selects the first Recommended variant with trade-off copy', async () => {
    useHardware.setState({
      hardwareData: { ...emptyHardwareData, total_memory: 16 * 1024 },
    })
    mocks.fetchHuggingFaceRepo.mockResolvedValueOnce({ id: 'repo' })
    mocks.convertHfRepoToCatalogModel.mockReturnValue({
      model_name: 'user/model',
      developer: 'user',
      downloads: 0,
      quants: [
        {
          model_id: 'model-Q4_K_M-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q4_K_M.gguf',
          file_size: '4.0 GB',
        },
        {
          model_id: 'model-Q8_0-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q8_0.gguf',
          file_size: '14.0 GB',
        },
      ],
    })
    ;(useParams as any).mockReturnValue({ modelId: 'user/model' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(
      await screen.findByText(/Best quality that fits your 16 GB RAM/)
    ).toBeInTheDocument()
    expect(screen.getByText('Best for you')).toBeInTheDocument()
  })

  it('falls back to the first tight-memory variant when none is Recommended', async () => {
    useHardware.setState({
      hardwareData: { ...emptyHardwareData, total_memory: 6 * 1024 },
    })
    mocks.fetchHuggingFaceRepo.mockResolvedValueOnce({ id: 'repo' })
    mocks.convertHfRepoToCatalogModel.mockReturnValue({
      model_name: 'user/model',
      developer: 'user',
      downloads: 0,
      quants: [
        {
          model_id: 'model-Q4_K_M-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q4_K_M.gguf',
          file_size: '4.0 GB',
        },
        {
          model_id: 'model-Q8_0-GGUF',
          path: 'https://huggingface.co/user/model/resolve/main/model-Q8_0.gguf',
          file_size: '14.0 GB',
        },
      ],
    })
    ;(useParams as any).mockReturnValue({ modelId: 'user/model' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(
      await screen.findByText(
        /Biggest variant that fits your 6 GB RAM \(tight\)/
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Best for you')).toBeInTheDocument()
  })
})
