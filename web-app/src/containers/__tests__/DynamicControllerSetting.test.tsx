import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    spellCheckChatInput: true,
  }),
}))

import { DynamicControllerSetting } from '../DynamicControllerSetting'

describe('DynamicControllerSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
      },
    })
  })

  it('renders text inputs with password visibility and copy actions', async () => {
    const onChange = vi.fn()

    render(
      <DynamicControllerSetting
        controllerType="input"
        controllerProps={{
          type: 'password',
          value: 'secret',
          input_actions: ['unobscure', 'copy'],
        }}
        onChange={onChange}
      />,
    )

    const input = screen.getByDisplayValue('secret')
    expect(input).toHaveAttribute('type', 'password')

    fireEvent.click(input.parentElement!.querySelector('button')!)
    expect(input).toHaveAttribute('type', 'text')

    fireEvent.change(input, { target: { value: 'new-secret' } })
    expect(onChange).toHaveBeenCalledWith('new-secret')

    const actionButtons = input.parentElement!.querySelectorAll('button')
    fireEvent.click(actionButtons[1])

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret')
    })
  })

  it('renders number inputs with bounded stepper controls', () => {
    const onChange = vi.fn()

    render(
      <DynamicControllerSetting
        controllerType="input"
        controllerProps={{ type: 'number', value: 5, min: 0, max: 6, step: 0.5 }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /increment/i }))
    fireEvent.click(screen.getByRole('button', { name: /decrement/i }))

    expect(onChange).toHaveBeenCalledWith('5.5')
    expect(onChange).toHaveBeenCalledWith('4.5')
  })

  it('renders checkbox and fallback switch controls', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <DynamicControllerSetting
        controllerType="checkbox"
        controllerProps={{ value: false }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(
      <DynamicControllerSetting
        controllerType="unknown"
        controllerProps={{ value: true }}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('switch')).toBeChecked()
  })

  it('renders textarea with spellcheck settings', () => {
    const onChange = vi.fn()

    render(
      <DynamicControllerSetting
        controllerType="textarea"
        controllerProps={{ value: 'hello', placeholder: 'Prompt', rows: 5 }}
        onChange={onChange}
      />,
    )

    const textarea = screen.getByPlaceholderText('Prompt')
    expect(textarea).toHaveAttribute('rows', '5')
    expect(textarea).toHaveAttribute('spellcheck', 'true')

    fireEvent.change(textarea, { target: { value: 'updated' } })
    expect(onChange).toHaveBeenCalledWith('updated')
  })

  it('renders dropdown options and emits selected values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <DynamicControllerSetting
        controllerType="dropdown"
        controllerProps={{
          value: 'b',
          options: [
            { value: 'a', name: 'Alpha' },
            { value: 'b', name: 'Beta' },
          ],
        }}
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: /beta/i }))
    await user.click(await screen.findByText('Alpha'))

    expect(onChange).toHaveBeenCalledWith('a')
  })
})
