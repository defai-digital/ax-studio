import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  assertAllowedDownloadUrl,
  resolveUvExecutableSource,
} from '../download-bin.mjs'

describe('download URL host allow-list', () => {
  it('accepts github and objects.githubusercontent hosts', () => {
    expect(
      assertAllowedDownloadUrl(
        'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun.zip',
      ),
    ).toContain('github.com')
    expect(
      assertAllowedDownloadUrl(
        'https://objects.githubusercontent.com/github-production-release-asset/1/file',
      ),
    ).toContain('objects.githubusercontent.com')
  })

  it('rejects unexpected redirect hosts and non-https schemes', () => {
    expect(() =>
      assertAllowedDownloadUrl('https://evil.example/malware.bin', 'redirect'),
    ).toThrow(/allow-list/)
    expect(() =>
      assertAllowedDownloadUrl('http://github.com/x', 'download'),
    ).toThrow(/https/)
  })
})

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
