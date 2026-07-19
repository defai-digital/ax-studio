import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveUvExecutableSource } from '../download-bin.mjs'

describe('bundled uv archive layouts', () => {
  it('reads uv.exe from the root of Windows release ZIPs', () => {
    expect(
      resolveUvExecutableSource(
        '/extract',
        'x86_64-pc-windows-msvc',
        'win32',
      ),
    ).toBe(path.join('/extract', 'uv.exe'))

    expect(
      resolveUvExecutableSource(
        '/extract',
        'aarch64-pc-windows-msvc',
        'win32',
      ),
    ).toBe(path.join('/extract', 'uv.exe'))
  })

  it('reads uv from the target directory in Unix release tarballs', () => {
    expect(
      resolveUvExecutableSource(
        '/extract',
        'aarch64-apple-darwin',
        'darwin',
      ),
    ).toBe(path.join('/extract', 'uv-aarch64-apple-darwin', 'uv'))
  })
})
