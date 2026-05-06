import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const mockSetTheme = vi.fn()
let activeTheme = 'dark'

vi.mock('@/hooks/ui/useTheme', () => ({
  useTheme: () => ({
    activeTheme,
    setTheme: mockSetTheme,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common:light': 'Light',
        'common:dark': 'Dark',
        'common:system': 'System',
      })[key] ?? key,
  }),
}))

import { ThemeSwitcher } from '../ThemeSwitcher'

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeTheme = 'dark'
  })

  it('renders all theme choices and marks the active one', () => {
    render(<ThemeSwitcher />)

    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Dark').closest('button')).toHaveClass(
      'border-primary',
    )
  })

  it('updates the selected theme when a choice is clicked', () => {
    render(<ThemeSwitcher />)

    fireEvent.click(screen.getByText('System').closest('button')!)

    expect(mockSetTheme).toHaveBeenCalledWith('auto')
  })
})
