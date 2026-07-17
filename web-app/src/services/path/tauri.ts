/**
 * Tauri Path Service - Desktop implementation
 */

import { sep as getSep, join, dirname, basename, extname } from '@tauri-apps/api/path'
import type { PathService } from './types'
import {
  joinPathSegments,
  dirnameFallback,
  basenameFallback,
  extnameFallback,
} from './fallback'
import { withTauriFallbackSync } from '../tauri-guard'

export class TauriPathService implements PathService {
  sep(): string {
    // Note: sep() is synchronous in Tauri v2 (unlike other path functions)
    return withTauriFallbackSync(
      () => getSep() as unknown as string,
      'Error getting path separator in Tauri:',
      '/'
    )
  }

  async join(...segments: string[]): Promise<string> {
    try {
      return await join(...segments)
    } catch (error) {
      console.error('Error joining paths in Tauri:', error)
      return joinPathSegments(...segments)
    }
  }

  async dirname(path: string): Promise<string> {
    try {
      return await dirname(path)
    } catch (error) {
      console.error('Error getting dirname in Tauri:', error)
      return dirnameFallback(path, '.')
    }
  }

  async basename(path: string): Promise<string> {
    try {
      return await basename(path)
    } catch (error) {
      console.error('Error getting basename in Tauri:', error)
      return basenameFallback(path)
    }
  }

  async extname(path: string): Promise<string> {
    try {
      return await extname(path)
    } catch (error) {
      console.error('Error getting extname in Tauri:', error)
      return extnameFallback(path)
    }
  }
}
