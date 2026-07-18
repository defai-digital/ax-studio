import { describe, expect, it } from 'vitest'
import { acceleratorFromEvent, acceleratorToKeys } from '../accelerator'

const noModifiers = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
}

describe('acceleratorFromEvent', () => {
  it('returns null for pure modifier presses', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) {
      expect(acceleratorFromEvent({ key, ...noModifiers })).toBeNull()
    }
  })

  it('maps meta or ctrl to the cross-platform CmdOrCtrl', () => {
    expect(
      acceleratorFromEvent({ key: ' ', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false })
    ).toBe('CmdOrCtrl+Shift+Space')
    expect(
      acceleratorFromEvent({ key: 'k', metaKey: false, shiftKey: false, ctrlKey: true, altKey: false })
    ).toBe('CmdOrCtrl+K')
  })

  it('includes alt and shift in order', () => {
    expect(
      acceleratorFromEvent({ key: 'F5', metaKey: true, ctrlKey: false, altKey: true, shiftKey: true })
    ).toBe('CmdOrCtrl+Alt+Shift+F5')
  })

  it('maps space and arrow keys to Tauri key names', () => {
    expect(acceleratorFromEvent({ key: ' ', ...noModifiers })).toBe('Space')
    expect(acceleratorFromEvent({ key: 'Spacebar', ...noModifiers })).toBe('Space')
    expect(acceleratorFromEvent({ key: 'ArrowUp', ...noModifiers })).toBe('Up')
    expect(acceleratorFromEvent({ key: 'ArrowDown', ...noModifiers })).toBe('Down')
  })

  it('uppercases single character keys', () => {
    expect(acceleratorFromEvent({ key: 'a', ...noModifiers })).toBe('A')
    expect(acceleratorFromEvent({ key: '1', ...noModifiers })).toBe('1')
  })

  it('keeps named keys as-is', () => {
    expect(acceleratorFromEvent({ key: 'Enter', ...noModifiers })).toBe('Enter')
    expect(acceleratorFromEvent({ key: 'F12', ...noModifiers })).toBe('F12')
  })
})

describe('acceleratorToKeys', () => {
  it('splits an accelerator into ordered parts', () => {
    expect(acceleratorToKeys('CmdOrCtrl+Shift+Space')).toEqual([
      'CmdOrCtrl',
      'Shift',
      'Space',
    ])
  })

  it('handles a single key', () => {
    expect(acceleratorToKeys('F9')).toEqual(['F9'])
  })
})
