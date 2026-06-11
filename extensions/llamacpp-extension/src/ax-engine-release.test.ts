import { describe, expect, it } from 'vitest'
import {
  axEngineAssetInfo,
  parseSha256File,
  pickNewestVersionDir,
} from './ax-engine-release'

describe('axEngineAssetInfo', () => {
  it('builds asset names and URLs from a release tag', () => {
    expect(axEngineAssetInfo('v6.3.0')).toEqual({
      filename: 'ax-engine-v6.3.0-macos-arm64.tar.gz',
      url: 'https://github.com/defai-digital/ax-engine/releases/download/v6.3.0/ax-engine-v6.3.0-macos-arm64.tar.gz',
      shaUrl:
        'https://github.com/defai-digital/ax-engine/releases/download/v6.3.0/ax-engine-v6.3.0-macos-arm64.tar.gz.sha256',
    })
  })

  it('rejects tags that could break out of the URL path', () => {
    expect(() => axEngineAssetInfo('')).toThrow()
    expect(() => axEngineAssetInfo('v1/../evil')).toThrow()
    expect(() => axEngineAssetInfo('v1?x=y')).toThrow()
  })
})

describe('parseSha256File', () => {
  const hash =
    '8bc4f338f73520f1d6b4354f6f8612142e6acf4f8d054e96162cc4a879ecc021'

  it('parses the standard "<hex>  <filename>" format', () => {
    expect(
      parseSha256File(
        `${hash}  ax-engine-v6.3.0-macos-arm64.tar.gz\n`,
        'ax-engine-v6.3.0-macos-arm64.tar.gz'
      )
    ).toBe(hash)
  })

  it('lowercases the digest', () => {
    expect(parseSha256File(`${hash.toUpperCase()}  f.tar.gz`, 'f.tar.gz')).toBe(
      hash
    )
  })

  it('returns null for wrong filename, bad hash, or empty content', () => {
    expect(parseSha256File(`${hash}  other.tar.gz`, 'f.tar.gz')).toBeNull()
    expect(parseSha256File('nothex  f.tar.gz', 'f.tar.gz')).toBeNull()
    expect(parseSha256File('', 'f.tar.gz')).toBeNull()
  })
})

describe('pickNewestVersionDir', () => {
  it('picks the numerically newest version', () => {
    expect(pickNewestVersionDir(['v6.2.7', 'v6.3.0', 'v6.2.10'])).toBe(
      'v6.3.0'
    )
    expect(pickNewestVersionDir(['v6.10.0', 'v6.9.9'])).toBe('v6.10.0')
  })

  it('accepts versions without the v prefix', () => {
    expect(pickNewestVersionDir(['6.3.0', 'v6.2.7'])).toBe('6.3.0')
  })

  it('ignores non-version entries and returns null when none match', () => {
    expect(pickNewestVersionDir(['ax-engine-server', 'v6.3.0'])).toBe('v6.3.0')
    expect(pickNewestVersionDir(['ax-engine-server', 'tmp'])).toBeNull()
    expect(pickNewestVersionDir([])).toBeNull()
  })
})
