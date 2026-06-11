/**
 * ax-engine GitHub release helpers (pure logic).
 *
 * Releases ship one archive per platform, flat layout:
 *   ax-engine-<tag>-macos-arm64.tar.gz   (contains ax-engine-server at root)
 *   ax-engine-<tag>-macos-arm64.tar.gz.sha256
 */

const AX_ENGINE_REPO = 'defai-digital/ax-engine'
const AX_ENGINE_PLATFORM = 'macos-arm64'

export interface AxEngineAsset {
  filename: string
  url: string
  shaUrl: string
}

/** Build the download asset names/URLs for a release tag (e.g. "v6.3.0") */
export function axEngineAssetInfo(tag: string): AxEngineAsset {
  if (!/^v?[0-9A-Za-z.\-_]+$/.test(tag)) {
    throw new Error(`Invalid ax-engine release tag: "${tag}"`)
  }
  const filename = `ax-engine-${tag}-${AX_ENGINE_PLATFORM}.tar.gz`
  const base = `https://github.com/${AX_ENGINE_REPO}/releases/download/${tag}`
  return {
    filename,
    url: `${base}/${filename}`,
    shaUrl: `${base}/${filename}.sha256`,
  }
}

/**
 * Parse a `<hex>  <filename>` sha256 file. Returns the hex digest, or null
 * if the content does not match the expected filename or shape.
 */
export function parseSha256File(
  content: string,
  expectedFilename: string
): string | null {
  for (const line of content.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const [hash, name] = parts
    if (name === expectedFilename && /^[0-9a-fA-F]{64}$/.test(hash)) {
      return hash.toLowerCase()
    }
  }
  return null
}

/**
 * Pick the newest installed version from a list of directory names like
 * ["v6.3.0", "v6.2.7"]. Numeric-aware descending sort; returns null when
 * the list has no version-shaped entries.
 */
export function pickNewestVersionDir(dirNames: string[]): string | null {
  const versioned = dirNames
    .map((name) => {
      const m = name.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
      return m
        ? { name, key: [Number(m[1]), Number(m[2]), Number(m[3])] }
        : null
    })
    .filter((x): x is { name: string; key: number[] } => x !== null)
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]
      }
      return 0
    })
  return versioned[0]?.name ?? null
}
