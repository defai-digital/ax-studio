import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route } from './$modelId'

// Mock dependencies
vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/hooks/useModelSources', () => ({
  useModelSources: () => ({
    sources: [],
    fetchSources: vi.fn(),
  }),
}))

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    huggingfaceToken: null,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      fetchHuggingFaceRepo: vi.fn().mockResolvedValue(null),
      convertHfRepoToCatalogModel: vi.fn(),
      isModelSupported: vi.fn().mockResolvedValue('GREEN'),
      pullModelWithMetadata: vi.fn(),
    }),
  }),
}))

vi.mock('@/hooks/useDownloadStore', () => ({
  useDownloadStore: () => ({
    downloads: {},
    localDownloadingModels: new Set(),
    addLocalDownloadingModel: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
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
  Eye: () => <div />,
  Wrench: () => <div />,
  Calendar: () => <div />,
  Download: () => <div />,
  ExternalLink: () => <div />,
  HardDrive: () => <div />,
}))

vi.mock('@tabler/icons-react', () => ({
  IconArrowLeft: () => <div />,
}))

vi.mock('@/lib/models', () => ({
  extractModelName: vi.fn(),
  extractDescription: vi.fn(),
}))

vi.mock('@/lib/utils', () => ({
  sanitizeModelId: vi.fn((id) =>
    id.replace(/[^a-zA-Z0-9/_\-.]/g, '').replace(/\./g, '_')
  ),
}))

import { useParams } from '@tanstack/react-router'
import { sanitizeModelId } from '@/lib/utils'

describe('Hub Model Detail Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should sanitize the modelId parameter', () => {
    const mockModelId = 'user/model<script>alert("xss")</script>'
    ;(useParams as any).mockReturnValue({ modelId: mockModelId })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(sanitizeModelId).toHaveBeenCalledWith(mockModelId)
    expect(sanitizeModelId).toHaveReturnedWith(
      'user/modelscriptalertxss/script'
    )
  })

  it('should render "Model not found" when no model data', () => {
    ;(useParams as any).mockReturnValue({ modelId: 'valid/model' })

    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Model not found')).toBeInTheDocument()
  })
})
