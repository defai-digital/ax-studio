import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockDebounceCancel = vi.fn()
const mockUpdateProvider = vi.fn()
const mockStopModel = vi.fn().mockResolvedValue(undefined)
const mockGetActiveModels = vi.fn().mockResolvedValue([])
const mockSetActiveModels = vi.fn()

vi.mock('lodash.debounce', () => ({
  default: vi.fn((fn: (...args: unknown[]) => void) =>
    Object.assign(fn, { cancel: mockDebounceCancel })
  ),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    updateProvider: mockUpdateProvider,
  })),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      stopModel: mockStopModel,
      getActiveModels: mockGetActiveModels,
    }),
  }),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: vi.fn((selector) =>
    selector({ setActiveModels: mockSetActiveModels })
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts?.modelId ? `${key} ${opts.modelId}` : key,
  }),
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet">{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet-content">{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p data-testid="sheet-desc">{children}</p>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2 data-testid="sheet-title">{children}</h2>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet-trigger">{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/containers/DynamicControllerSetting', () => ({
  DynamicControllerSetting: ({
    title,
    description,
    onChange,
  }: {
    title: string
    description: string
    onChange: (value: number) => void
  }) => (
    <button data-testid={`setting-${title}`} onClick={() => onChange(4096)}>
      <span>{title}</span>
      <span>{description}</span>
    </button>
  ),
}))

vi.mock('lucide-react', () => ({
  Settings: () => <span data-testid="settings-icon" />,
}))

import { ModelSetting } from '../ModelSetting'

describe('ModelSetting', () => {
  const provider = {
    provider: 'llamacpp',
    apiKey: '',
    models: [
      {
        id: 'model-1',
        name: 'Test Model',
        settings: {
          ctx_len: {
            key: 'ctx_len',
            title: 'Context Length',
            description: 'Maximum context length',
            controller_type: 'slider',
            controller_props: { value: 2048, min: 512, max: 8192 },
          },
          ngl: {
            key: 'ngl',
            title: 'GPU Layers',
            description: 'Number of GPU layers',
            controller_type: 'slider',
            controller_props: { value: 32, min: 0, max: 64 },
          },
        },
      },
    ],
  } as unknown as ProviderObject

  const model = provider.models[0]

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetActiveModels.mockResolvedValue([])
    mockStopModel.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the settings trigger button', () => {
    render(<ModelSetting model={model} provider={provider} />)

    expect(screen.getByTestId('sheet-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('settings-icon')).toBeInTheDocument()
  })

  it('renders sheet title with model name', () => {
    render(<ModelSetting model={model} provider={provider} />)

    expect(screen.getByTestId('sheet-title')).toBeInTheDocument()
  })

  it('renders all model settings as DynamicControllerSetting', () => {
    render(<ModelSetting model={model} provider={provider} />)

    expect(screen.getByTestId('setting-Context Length')).toBeInTheDocument()
    expect(screen.getByTestId('setting-GPU Layers')).toBeInTheDocument()
  })

  it('renders setting descriptions', () => {
    render(<ModelSetting model={model} provider={provider} />)

    // Each description appears twice: once in DynamicControllerSetting mock, once in <p> below it
    const ctxDescs = screen.getAllByText('Maximum context length')
    expect(ctxDescs.length).toBe(2)
    const nglDescs = screen.getAllByText('Number of GPU layers')
    expect(nglDescs.length).toBe(2)
  })

  it('renders with empty settings', () => {
    const modelNoSettings = { ...model, settings: {} }
    render(
      <ModelSetting
        model={modelNoSettings}
        provider={{ ...provider, models: [modelNoSettings] } as unknown as ProviderObject}
      />
    )

    // Should render the sheet without settings items
    expect(screen.getByTestId('sheet')).toBeInTheDocument()
    expect(screen.queryByTestId(/^setting-/)).not.toBeInTheDocument()
  })

  it('renders with undefined settings', () => {
    const modelUndefinedSettings = { ...model, settings: undefined }
    render(
      <ModelSetting
        model={modelUndefinedSettings}
        provider={{ ...provider, models: [modelUndefinedSettings] } as unknown as ProviderObject}
      />
    )

    expect(screen.getByTestId('sheet')).toBeInTheDocument()
  })

  it('stops a running model through its actual provider after a load setting changes', async () => {
    vi.useFakeTimers()
    mockGetActiveModels.mockResolvedValue(['model-1'])
    const mlxProvider = {
      ...provider,
      provider: 'ax-engine',
    } as unknown as ProviderObject
    render(<ModelSetting model={model} provider={mlxProvider} />)

    fireEvent.click(screen.getByTestId('setting-Context Length'))
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(mockStopModel).toHaveBeenCalledWith('model-1', 'ax-engine')
  })

  it('does not treat an unsuccessful unload result as a stopped model', async () => {
    vi.useFakeTimers()
    mockGetActiveModels.mockResolvedValue(['model-1'])
    mockStopModel.mockResolvedValue({ success: false, error: 'model is busy' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ModelSetting model={model} provider={provider} />)

    fireEvent.click(screen.getByTestId('setting-Context Length'))
    await act(async () => {
      await Promise.resolve()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockGetActiveModels).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to stop model:',
      expect.objectContaining({ message: 'model is busy' })
    )
  })

  it('does not schedule a model stop when the active-model check resolves after unmount', async () => {
    vi.useFakeTimers()
    let resolveActiveModels!: (models: string[]) => void
    mockGetActiveModels.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveActiveModels = resolve
      })
    )
    const view = render(<ModelSetting model={model} provider={provider} />)

    fireEvent.click(screen.getByTestId('setting-Context Length'))
    view.unmount()
    await act(async () => {
      resolveActiveModels(['model-1'])
      await Promise.resolve()
      vi.advanceTimersByTime(500)
    })

    expect(mockStopModel).not.toHaveBeenCalled()
  })
})
