declare module 'unzipper' {
  import type { Readable, Writable } from 'node:stream'

  export interface ZipEntry {
    path: string
    type: 'File' | 'Directory'
    versionMadeBy: number
    externalFileAttributes: number
    stream(): Readable
  }

  export const Open: {
    file(path: string): Promise<{ files: ZipEntry[] }>
  }

  export interface ExtractOptions {
    path: string
  }

  export function Extract(options: ExtractOptions): Writable
}
