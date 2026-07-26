declare module 'unzipper' {
  import type { Writable } from 'node:stream'

  export interface ExtractOptions {
    path: string
  }

  export function Extract(options: ExtractOptions): Writable
}
