import type { MouseEvent } from 'react'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startWindowDragFromMouseEvent } from '@/lib/window-drag'

const mockStartDragging = vi.fn()

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    startDragging: mockStartDragging,
  }),
}))

function createMouseEvent(
  target: EventTarget | null,
  options: { button?: number; clientY?: number } = {}
): MouseEvent<HTMLElement> {
  return {
    button: options.button ?? 0,
    clientY: options.clientY ?? 0,
    target,
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
    chrome.innerHTML = '<div><span>Ax Studio</span></div>'

    startWindowDragFromMouseEvent(
      createMouseEvent(chrome.querySelector('span'))
    )

    expect(mockStartDragging).toHaveBeenCalledTimes(1)
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
})
