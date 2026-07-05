import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchHuggingFaceRepo: vi.fn(),
  convertHfRepoToCatalogModel: vi.fn(),
  fetchSources: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/common/Card', () => ({
  CardItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      aria-label="toggle-filter"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      type="checkbox"
    />
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/containers/ModelInfoHoverCard', () => ({
  ModelInfoHoverCard: () => <div />,
}))

vi.mock('@/containers/DownloadButton', () => ({
  DownloadButtonPlaceholder: () => <div />,
}))

vi.mock('@/containers/ModelDownloadAction', () => ({
  ModelDownloadAction: () => <button>Download</button>,
}))

vi.mock('@/containers/RenderMarkdown', () => ({
  RenderMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children: ReactNode }) => (
      <div {...props}>{children}</div>
    ),
  },
}))

vi.mock('lucide-react', () => {
  const Icon = () => <span />
  return {
    Atom: Icon,
    CheckCircle2: Icon,
    ChevronsUpDown: Icon,
    Download: Icon,
    Eye: Icon,
    FileCode: Icon,
    HardDrive: Icon,
    Loader: Icon,
    MessageCircle: Icon,
    RotateCcw: Icon,
    Search: Icon,
    Wrench: Icon,
    X: Icon,
  }
})

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'hub:allModels': 'All Models',
        'hub:downloaded': 'Downloaded',
        'hub:searchPlaceholder': 'Search models, developers...',
        'hub:sortNewest': 'Newest',
        'hub:sortMostDownloaded': 'Most downloaded',
        'hub:subtitle':
          'Discover and download open-source AI models. Optimized for local inference.',
        'hub:title': 'Model Hub',
      }
      return translations[key] ?? options?.defaultValue ?? key
    },
  }),
}))

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: (
    selector: (state: { huggingfaceToken: string }) => string
  ) => selector({ huggingfaceToken: 'hf-token' }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (selector: (state: { providers: [] }) => unknown) =>
    selector({ providers: [] }),
}))

vi.mock('@/hooks/models/useModelSources', () => ({
  useModelSources: (
    selector: (state: {
      sources: []
      fetchSources: () => Promise<void>
      loading: boolean
    }) => unknown
  ) =>
    selector({
      sources: [],
      fetchSources: mocks.fetchSources,
      loading: false,
    }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      fetchHuggingFaceRepo: mocks.fetchHuggingFaceRepo,
      convertHfRepoToCatalogModel: mocks.convertHfRepoToCatalogModel,
      isModelSupported: vi.fn().mockResolvedValue('GREEN'),
    }),
  }),
}))

vi.mock('@/lib/models/downloaded', () => ({
  findDownloadedCatalogModel: vi.fn().mockReturnValue(undefined),
}))

vi.mock('@/lib/models', () => ({
  extractDescription: vi.fn((description: string) => description),
  extractModelName: vi.fn((modelName: string) => modelName),
}))

vi.mock('@/constants/models', () => ({
  DEFAULT_MODEL_QUANTIZATIONS: [],
}))

import { Route } from '../index'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('Hub index search', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.fetchHuggingFaceRepo.mockResolvedValue(null)
    mocks.fetchSources.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('cancels a pending Hugging Face lookup when the search is cleared', async () => {
    const Component = Route.component as React.ComponentType

    render(<Component />)

    const input = screen.getByPlaceholderText('Search models, developers...')
    fireEvent.change(input, { target: { value: 'mlx-community/model' } })
    fireEvent.change(input, { target: { value: '' } })

    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(mocks.fetchHuggingFaceRepo).not.toHaveBeenCalled()
  })

  it('ignores stale Hugging Face lookup results after a newer search starts', async () => {
    const firstLookup = deferred<unknown>()
    const secondLookup = deferred<unknown>()
    mocks.fetchHuggingFaceRepo.mockImplementation((value: string) => {
      if (value === 'org/first-model') return firstLookup.promise
      if (value === 'org/second-model') return secondLookup.promise
      return Promise.resolve(null)
    })
    mocks.convertHfRepoToCatalogModel.mockImplementation((repoInfo) => repoInfo)

    const Component = Route.component as React.ComponentType
    render(<Component />)

    const input = screen.getByPlaceholderText('Search models, developers...')

    fireEvent.change(input, { target: { value: 'org/first-model' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    fireEvent.change(input, { target: { value: 'org/second-model' } })
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    await act(async () => {
      firstLookup.resolve({
        model_name: 'first-model',
        developer: 'org',
        description: 'stale result',
        quants: [],
      })
      await Promise.resolve()
    })

    expect(screen.queryByText('first-model')).not.toBeInTheDocument()

    await act(async () => {
      secondLookup.resolve({
        model_name: 'second-model',
        developer: 'org',
        description: 'current result',
        quants: [],
      })
      await Promise.resolve()
    })

    expect(screen.getByText('second-model')).toBeInTheDocument()
  })
})
