import type { MouseEvent } from 'react'

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

const WINDOW_DRAG_IGNORE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'label',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="link"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[data-window-drag-ignore]',
].join(',')

type StartWindowDragOptions = {
  topInset?: number
  logContext?: string
}

type ToggleWindowMaximizeOptions = StartWindowDragOptions

function canStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  return !target.closest(WINDOW_DRAG_IGNORE_SELECTOR)
}

function isWithinWindowChrome(
  event: MouseEvent<HTMLElement>,
  topInset: number | undefined
) {
  return topInset === undefined || event.clientY <= topInset
}

export function startWindowDragFromMouseEvent(
  event: MouseEvent<HTMLElement>,
  { topInset, logContext = 'window-drag' }: StartWindowDragOptions = {}
) {
  if (
    !IS_TAURI ||
    event.button !== 0 ||
    event.detail > 1 ||
    !canStartWindowDrag(event.target)
  ) {
    return
  }

  if (!isWithinWindowChrome(event, topInset)) {
    return
  }

  try {
    void getCurrentWebviewWindow().startDragging()
  } catch (error) {
    console.error(`[${logContext}] Failed to start window drag:`, error)
  }
}

export function toggleWindowMaximizeFromMouseEvent(
  event: MouseEvent<HTMLElement>,
  { topInset, logContext = 'window-drag' }: ToggleWindowMaximizeOptions = {}
) {
  if (!IS_TAURI || event.button !== 0 || !canStartWindowDrag(event.target)) {
    return
  }

  if (!isWithinWindowChrome(event, topInset)) {
    return
  }

  event.preventDefault()

  try {
    void getCurrentWebviewWindow().toggleMaximize()
  } catch (error) {
    console.error(`[${logContext}] Failed to toggle window maximize:`, error)
  }
}
