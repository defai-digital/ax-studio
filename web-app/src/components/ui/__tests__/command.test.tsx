import React from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '../command'

describe('Command components', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('renders the command palette primitives', () => {
    render(
      <Command label="Actions" className="custom-command">
        <CommandInput placeholder="Search actions" />
        <CommandList>
          <CommandEmpty>No actions</CommandEmpty>
          <CommandGroup heading="General">
            <CommandItem value="open">Open</CommandItem>
            <CommandSeparator />
            <CommandItem value="save">
              Save
              <CommandShortcut>Cmd+S</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    )

    expect(screen.getByPlaceholderText('Search actions')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Save')).toBeInTheDocument()
    expect(screen.getByText('Cmd+S')).toHaveClass('tracking-widest')
    expect(document.querySelector('.custom-command')).toBeInTheDocument()
  })

  it('renders command dialog content when controlled open', () => {
    render(
      <CommandDialog open>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandItem value="settings">Settings</CommandItem>
        </CommandList>
      </CommandDialog>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
