import { beforeEach, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

const mocks = vi.hoisted(() => {
  const model = {
    id: 'model-a',
    displayName: 'Model A',
    settings: {
      ctx_len: {
        key: 'ctx_len',
        title: 'Context size',
        controller_type: 'input',
        controller_props: { type: 'number', value: 8192 },
      },
    },
  }
  const providers = [
    {
      provider: 'ollama',
      active: true,
      models: [model, { id: 'model-b', displayName: 'Model B' }],
      settings: [],
    },
  ]
  return {
    providers,
    model,
    select: vi.fn(),
    update: vi.fn(),
    updateCurrent: vi.fn(),
    updateProvider: vi.fn(),
  }
})
vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (select?: (state: unknown) => unknown) => {
    const state = {
      providers: mocks.providers,
      selectedProvider: 'ollama',
      selectedModel: mocks.model,
      getProviderByName: () => mocks.providers[0],
      selectModelProvider: mocks.select,
      updateProvider: mocks.updateProvider,
    }
    return select ? select(state) : state
  },
}))
vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: (select?: (state: unknown) => unknown) => {
    const state = {
      currentThreadId: 'left',
      updateThread: mocks.update,
      updateCurrentThreadModel: mocks.updateCurrent,
    }
    return select ? select(state) : state
  },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({ getActiveModels: async () => [] }),
  }),
}))
vi.mock('@/hooks/models/useFavoriteModel', () => ({
  useFavoriteModel: () => ({ favoriteModels: [], toggleFavorite: vi.fn() }),
}))
vi.mock('@/lib/utils/getModelToStart', () => ({
  getLastUsedModel: () => null,
  setLastUsedModel: vi.fn(),
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
import { DropdownModelProvider } from '../DropdownModelProvider'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
it('keeps focus in the real settings sheet without opening model search (#842)', async () => {
  const view = render(
    <DropdownModelProvider
      threadId="right"
      model={{ id: 'model-a', provider: 'ollama' }}
    />
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'common:modelSettings.title' })
  )
  const dialog = await screen.findByRole('dialog')
  const input = within(dialog).getByRole('textbox')
  input.focus()
  fireEvent.change(input, { target: { value: '16384' } })
  const saved = mocks.updateProvider.mock.calls.at(-1)?.[1].models[0]
  expect(saved.settings.ctx_len.controller_props.value).toBe('16384')
  Object.assign(mocks.model, saved)
  view.rerender(
    <DropdownModelProvider
      threadId="right"
      model={{ id: 'model-a', provider: 'ollama' }}
    />
  )
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).toHaveValue('16384')
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  expect(mocks.updateProvider).toHaveBeenCalledWith(
    'ollama',
    expect.objectContaining({ models: expect.any(Array) })
  )
})
it('changes only the selected split pane and never initializes global selection (#841)', async () => {
  render(
    <DropdownModelProvider
      threadId="right"
      model={{ id: 'model-a', provider: 'ollama' }}
    />
  )
  expect(mocks.select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Model A' }))
  const input = await screen.findByPlaceholderText('common:searchModels')
  fireEvent.change(input, { target: { value: 'Model B' } })
  fireEvent.click(await screen.findByText('Model B'))
  expect(mocks.update).toHaveBeenCalledWith('right', {
    model: { id: 'model-b', provider: 'ollama' },
  })
  expect(mocks.updateCurrent).not.toHaveBeenCalled()
  expect(mocks.select).not.toHaveBeenCalled()
})
