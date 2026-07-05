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

function canStartWindowDrag(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  return !target.closest(WINDOW_DRAG_IGNORE_SELECTOR)
}

export function startWindowDragFromMouseEvent(
  event: MouseEvent<HTMLElement>,
  { topInset, logContext = 'window-drag' }: StartWindowDragOptions = {}
) {
  if (!IS_TAURI || event.button !== 0 || !canStartWindowDrag(event.target)) {
    return
  }

  if (topInset !== undefined && event.clientY > topInset) {
    return
  }

  try {
    void getCurrentWebviewWindow().startDragging()
  } catch (error) {
    console.error(`[${logContext}] Failed to start window drag:`, error)
  }
}
