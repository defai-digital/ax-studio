/**
 * Default Opener Service - Generic implementation with minimal returns
 */

import type { OpenerService } from './types'

export class DefaultOpenerService implements OpenerService {
  async revealItemInDir(path: string): Promise<void> {
    // No-op - not implemented in default service
  }
}
