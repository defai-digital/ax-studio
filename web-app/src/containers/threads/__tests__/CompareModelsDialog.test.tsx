import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { CompareModelsDialog } from '../CompareModelsDialog'
import { useModelProvider } from '@/hooks/models/useModelProvider'

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn(),
}))

const providers = [
  {
    provider: 'openai',
    models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
  },
  {
    provider: 'llamacpp',
    models: [{ id: 'qwen3-8b' }],
  },
] as unknown as ModelProvider[]

const renderDialog = (
  overrides: Partial<Parameters<typeof CompareModelsDialog>[0]> = {}
) => {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <CompareModelsDialog
      open
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      {...overrides}
    />
  )
  return { onConfirm, onOpenChange }
}

describe('CompareModelsDialog', () => {
  beforeEach(() => {
    vi.mocked(useModelProvider).mockImplementation((selector?: unknown) =>
      typeof selector === 'function'
        ? selector({ providers })
        : { providers }
    )
  })

  it('requires both panes to be filled before confirming', async () => {
    const user = userEvent.setup()
    renderDialog()

    const confirm = screen.getByRole('button', { name: 'Start comparing' })
    expect(confirm).toBeDisabled()

    await user.selectOptions(
      screen.getByLabelText('Left pane model'),
      JSON.stringify(['openai', 'gpt-4o'])
    )
    expect(confirm).toBeDisabled()
  })

  it('rejects picking the same model for both panes', async () => {
    const user = userEvent.setup()
    renderDialog()

    const same = JSON.stringify(['openai', 'gpt-4o'])
    await user.selectOptions(screen.getByLabelText('Left pane model'), same)
    await user.selectOptions(screen.getByLabelText('Right pane model'), same)

    expect(screen.getByRole('button', { name: 'Start comparing' })).toBeDisabled()
  })

  it('confirms with two distinct models and closes', async () => {
    const user = userEvent.setup()
    const { onConfirm, onOpenChange } = renderDialog()

    await user.selectOptions(
      screen.getByLabelText('Left pane model'),
      JSON.stringify(['openai', 'gpt-4o'])
    )
    await user.selectOptions(
      screen.getByLabelText('Right pane model'),
      JSON.stringify(['llamacpp', 'qwen3-8b'])
    )

    const confirm = screen.getByRole('button', { name: 'Start comparing' })
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(onConfirm).toHaveBeenCalledWith(
      { provider: 'openai', id: 'gpt-4o' },
      { provider: 'llamacpp', id: 'qwen3-8b' }
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('preselects the current thread model for the left pane', () => {
    renderDialog({
      defaultModelA: { provider: 'openai', id: 'gpt-4o-mini' },
    })

    expect(screen.getByLabelText('Left pane model')).toHaveValue(
      JSON.stringify(['openai', 'gpt-4o-mini'])
    )
    expect(screen.getByLabelText('Right pane model')).toHaveValue('')
  })
})
