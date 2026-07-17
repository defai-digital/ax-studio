/**
 * Tauri Deep Link Service - Desktop implementation
 */

import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'
import type { DeepLinkService } from './types'
import { withTauriFallback } from '../tauri-guard'

export class TauriDeepLinkService implements DeepLinkService {
  async onOpenUrl(handler: (urls: string[]) => void): Promise<() => void> {
    return withTauriFallback(
      () => onOpenUrl(handler),
      'Error setting up deep link handler in Tauri:',
      () => () => {}
    )
  }

  async getCurrent(): Promise<string[]> {
    return withTauriFallback(
      () => getCurrent().then((result) => result ?? []),
      'Error getting current deep links in Tauri:',
      () => []
    )
  }
}
