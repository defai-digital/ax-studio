import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../context-menu'

describe('ContextMenu components', () => {
  it('renders context menu content and item variants', async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Workspace</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel inset>Project</ContextMenuLabel>
          <ContextMenuGroup>
            <ContextMenuItem inset>
              Rename
              <ContextMenuShortcut>R</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuCheckboxItem checked>
              Show hidden files
            </ContextMenuCheckboxItem>
            <ContextMenuRadioGroup value="list">
              <ContextMenuRadioItem value="list">List</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuSub open>
            <ContextMenuSubTrigger inset>Open with</ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent>
                <ContextMenuItem>Editor</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>,
    )

    expect(screen.getByText('Workspace')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('Workspace'))

    await waitFor(() => {
      expect(screen.getByText('Project')).toBeInTheDocument()
    })

    expect(screen.getByText('Project')).toHaveClass('pl-8')
    expect(screen.getByText('Rename')).toHaveClass('pl-8')
    expect(screen.getByText('Show hidden files')).toBeInTheDocument()
    expect(screen.getByText('List')).toBeInTheDocument()
    expect(screen.getByText('Open with')).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()
    expect(screen.getByText('R')).toHaveClass('tracking-widest')
  })
})
