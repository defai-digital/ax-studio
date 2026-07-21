import type { MouseEvent } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  startWindowDragFromMouseEvent,
  toggleWindowMaximizeFromMouseEvent,
} from '@/lib/window-drag'

const mockStartDragging = vi.fn()
const mockToggleMaximize = vi.fn()

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    startDragging: mockStartDragging,
    toggleMaximize: mockToggleMaximize,
  }),
}))

function createMouseEvent(
  target: EventTarget | null,
  options: { button?: number; clientY?: number; detail?: number } = {}
): MouseEvent<HTMLElement> {
  return {
    button: options.button ?? 0,
    clientY: options.clientY ?? 0,
    detail: options.detail ?? 1,
    target,
    preventDefault: vi.fn(),
  } as unknown as MouseEvent<HTMLElement>
}

describe('window drag helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(globalThis, 'IS_TAURI', {
      configurable: true,
      value: true,
    })
  })

  it('starts dragging from non-interactive chrome elements', () => {
    const chrome = document.createElement('div')
    chrome.innerHTML = '<div><span>AX Studio</span></div>'

    startWindowDragFromMouseEvent(
      createMouseEvent(chrome.querySelector('span'))
    )

    expect(mockStartDragging).toHaveBeenCalledTimes(1)
  })

  it('does not start dragging on the second press of a double-click', () => {
    const chrome = document.createElement('div')

    startWindowDragFromMouseEvent(createMouseEvent(chrome, { detail: 2 }))

    expect(mockStartDragging).not.toHaveBeenCalled()
  })

  it('does not start dragging from interactive controls inside the chrome', () => {
    const chrome = document.createElement('div')
    chrome.innerHTML = `
      <button><span>Toggle</span></button>
      <input />
      <a href="/">Home</a>
      <div role="menuitem">Menu item</div>
      <div data-window-drag-ignore><span>Custom control</span></div>
    `

    startWindowDragFromMouseEvent(
      createMouseEvent(chrome.querySelector('button span'))
    )
    startWindowDragFromMouseEvent(
      createMouseEvent(chrome.querySelector('input'))
    )
    startWindowDragFromMouseEvent(createMouseEvent(chrome.querySelector('a')))
    startWindowDragFromMouseEvent(
      createMouseEvent(chrome.querySelector('[role="menuitem"]'))
    )
    startWindowDragFromMouseEvent(
      createMouseEvent(chrome.querySelector('[data-window-drag-ignore] span'))
    )

    expect(mockStartDragging).not.toHaveBeenCalled()
  })

  it('toggles maximize from a double-click on non-interactive chrome', () => {
    const chrome = document.createElement('div')
    const event = createMouseEvent(chrome)

    toggleWindowMaximizeFromMouseEvent(event)

    expect(mockToggleMaximize).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not toggle maximize from interactive controls inside the chrome', () => {
    const chrome = document.createElement('div')
    chrome.innerHTML = '<button><span>Maximize</span></button>'

    toggleWindowMaximizeFromMouseEvent(
      createMouseEvent(chrome.querySelector('button span'))
    )

    expect(mockToggleMaximize).not.toHaveBeenCalled()
  })

  it('does not toggle maximize below the configured top inset', () => {
    const chrome = document.createElement('div')

    toggleWindowMaximizeFromMouseEvent(createMouseEvent(chrome, { clientY: 61 }), {
      topInset: 60,
    })

    expect(mockToggleMaximize).not.toHaveBeenCalled()
  })
})
