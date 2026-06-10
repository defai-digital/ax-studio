import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '@testing-library/jest-dom'

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../drawer'

describe('Drawer components', () => {
  it('renders controlled drawer content and layout sections', () => {
    render(
      <Drawer open>
        <DrawerTrigger>Open drawer</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Drawer title</DrawerTitle>
            <DrawerDescription>Drawer description</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DrawerClose>Close</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>,
    )

    expect(screen.getByText('Open drawer')).toHaveAttribute(
      'data-slot',
      'drawer-trigger',
    )
    expect(screen.getByText('Drawer title')).toHaveAttribute(
      'data-slot',
      'drawer-title',
    )
    expect(screen.getByText('Drawer description')).toHaveClass(
      'text-muted-foreground',
    )
    expect(screen.getByText('Close')).toHaveAttribute('data-slot', 'drawer-close')
    expect(
      document.querySelector('[data-slot="drawer-overlay"]'),
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot="drawer-content"]')).toHaveClass(
      'bg-background',
    )
  })
})
