import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '../sidebar'

const mockUseIsMobile = vi.fn()
const mockHandleMouseDown = vi.fn()

vi.mock('@/hooks/ui/use-mobile', () => ({
  useIsMobile: () => mockUseIsMobile(),
}))

vi.mock('@/hooks/ui/use-sidebar-resize', () => ({
  useSidebarResize: vi.fn(() => ({
    dragRef: { current: null },
    handleMouseDown: mockHandleMouseDown,
  })),
}))

describe('Sidebar components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseIsMobile.mockReturnValue(false)
    document.cookie = 'sidebar:state=; max-age=0; path=/'
  })

  it('renders the desktop sidebar shell and toggles open state', () => {
    render(
      <SidebarProvider defaultOpen>
        <Sidebar data-testid="desktop-sidebar">
          <SidebarContent>Navigation</SidebarContent>
        </Sidebar>
        <SidebarTrigger aria-label="Toggle navigation" />
      </SidebarProvider>,
    )

    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(document.querySelector('[data-state]')).toHaveAttribute(
      'data-state',
      'expanded',
    )

    fireEvent.click(screen.getByRole('button', { name: /toggle navigation/i }))

    expect(document.querySelector('[data-state]')).toHaveAttribute(
      'data-state',
      'collapsed',
    )
    expect(document.cookie).toContain('sidebar:state=false')
  })

  it('uses controlled open state when provided', () => {
    const onOpenChange = vi.fn()

    render(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <Sidebar data-testid="controlled-sidebar">
          <SidebarContent>Controlled</SidebarContent>
        </Sidebar>
        <SidebarTrigger aria-label="Toggle controlled sidebar" />
      </SidebarProvider>,
    )

    expect(document.querySelector('[data-state]')).toHaveAttribute(
      'data-state',
      'collapsed',
    )

    fireEvent.click(
      screen.getByRole('button', { name: /toggle controlled sidebar/i }),
    )

    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('renders the non-collapsible variant without desktop chrome', () => {
    render(
      <SidebarProvider>
        <Sidebar collapsible="none" className="custom-sidebar">
          Fixed sidebar
        </Sidebar>
      </SidebarProvider>,
    )

    const sidebar = screen.getByText('Fixed sidebar')
    expect(sidebar).toHaveClass('custom-sidebar')
    expect(sidebar).not.toHaveAttribute('data-state')
  })

  it('routes mobile sidebar state through the sheet variant', () => {
    mockUseIsMobile.mockReturnValue(true)

    render(
      <SidebarProvider>
        <Sidebar side="right">
          <SidebarContent>Mobile content</SidebarContent>
        </Sidebar>
        <SidebarTrigger aria-label="Open mobile sidebar" />
      </SidebarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /open mobile sidebar/i }))

    expect(screen.getByText('Mobile content')).toBeInTheDocument()
    expect(document.querySelector('[data-mobile="true"]')).toBeInTheDocument()
  })

  it('renders sidebar layout primitives with their data markers', () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarHeader>Header</SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Group</SidebarGroupLabel>
              <SidebarGroupAction aria-label="Group action" />
              <SidebarGroupContent>Group content</SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            <SidebarInput aria-label="Filter" />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive size="lg" variant="outline">
                  <span>Menu item</span>
                </SidebarMenuButton>
                <SidebarMenuAction aria-label="Menu action" showOnHover />
                <SidebarMenuBadge>3</SidebarMenuBadge>
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="#sub" isActive size="sm">
                      Sub item
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
          <SidebarFooter>Footer</SidebarFooter>
          <SidebarRail aria-label="Resize sidebar" />
        </Sidebar>
        <SidebarInset>Inset</SidebarInset>
      </SidebarProvider>,
    )

    expect(screen.getByText('Header')).toHaveAttribute(
      'data-sidebar',
      'header',
    )
    expect(screen.getByText('Group')).toHaveAttribute(
      'data-sidebar',
      'group-label',
    )
    expect(screen.getByText('Menu item').closest('button')).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(screen.getByText('Sub item')).toHaveAttribute('data-size', 'sm')
    expect(
      document.querySelector('[data-sidebar="menu-skeleton-icon"]'),
    ).toBeInTheDocument()
    expect(screen.getByText('Inset')).toHaveClass('bg-background')

    fireEvent.mouseDown(screen.getByRole('button', { name: /resize sidebar/i }))

    expect(mockHandleMouseDown).toHaveBeenCalledTimes(1)
  })

  it('supports asChild labels and buttons', () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarGroupLabel asChild>
            <a href="#group">Linked group</a>
          </SidebarGroupLabel>
          <SidebarMenuButton asChild>
            <a href="#menu">Linked menu</a>
          </SidebarMenuButton>
          <SidebarMenuSubButton asChild>
            <button type="button">Sub action</button>
          </SidebarMenuSubButton>
        </Sidebar>
      </SidebarProvider>,
    )

    expect(screen.getByText('Linked group')).toHaveAttribute('href', '#group')
    expect(screen.getByText('Linked menu')).toHaveAttribute('href', '#menu')
    expect(screen.getByRole('button', { name: 'Sub action' })).toHaveAttribute(
      'data-sidebar',
      'menu-sub-button',
    )
  })
})
