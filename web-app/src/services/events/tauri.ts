/**
 * Tauri Events Service - Desktop implementation
 */

import { emit, listen } from '@tauri-apps/api/event'
import type { EventOptions, UnlistenFn, EventsService } from './types'
import { withTauriFallback } from '../tauri-guard'

export class TauriEventsService implements EventsService {
   
  async emit<T>(event: string, payload?: T, _options?: EventOptions): Promise<void> {
    return withTauriFallback(
      () => emit(event, payload),
      'Error emitting Tauri event:',
      () => undefined
    )
  }

   
  async listen<T>(event: string, handler: (event: { payload: T }) => void, _options?: EventOptions): Promise<UnlistenFn> {
    return withTauriFallback(
      () => listen<T>(event, handler),
      'Error listening to Tauri event:',
      () => () => {}
    )
  }
}
