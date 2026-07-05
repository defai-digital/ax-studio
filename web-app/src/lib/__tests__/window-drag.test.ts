import { describe, expect, it } from 'vitest'

import { canStartWindowDrag } from '@/lib/window-drag'

describe('window drag helpers', () => {
  it('allows dragging from non-interactive chrome elements', () => {
    const chrome = document.createElement('div')
    chrome.innerHTML = '<div><span>Ax Studio</span></div>'

    expect(canStartWindowDrag(chrome.querySelector('span'))).toBe(true)
  })

  it('ignores interactive controls inside the chrome', () => {
    const chrome = document.createElement('div')
    chrome.innerHTML = `
      <button><span>Toggle</span></button>
      <input />
      <a href="/">Home</a>
      <div role="menuitem">Menu item</div>
      <div data-window-drag-ignore><span>Custom control</span></div>
    `

    expect(canStartWindowDrag(chrome.querySelector('button span'))).toBe(false)
    expect(canStartWindowDrag(chrome.querySelector('input'))).toBe(false)
    expect(canStartWindowDrag(chrome.querySelector('a'))).toBe(false)
    expect(canStartWindowDrag(chrome.querySelector('[role="menuitem"]'))).toBe(
      false
    )
    expect(
      canStartWindowDrag(
        chrome.querySelector('[data-window-drag-ignore] span')
      )
    ).toBe(false)
  })
})
