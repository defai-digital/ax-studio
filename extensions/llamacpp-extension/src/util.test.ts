import { describe, it, expect, beforeEach, vi } from 'vitest'
import { invoke } from '../../../web-app/src/lib/tauri-shim/api-core'
import {
  getProxyConfig,
  buildProxyArg,
  estimateTokensFromText,
  createRandomApiSecret,
  buildEmbedBatches,
  mergeEmbedResponses,
  parseSimpleYaml,
  toSimpleYaml,
} from './util'

vi.mock('../../../web-app/src/lib/tauri-shim/api-core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))

const invokeMock = vi.mocked(invoke)

const basenameNoExt = (filePath: string): string => {
  const name = filePath.includes('/') ? filePath.split('/').pop()! : filePath
  const compoundExtensions = ['.tar.gz', '.tar.bz2', '.tar.xz']

  for (const extension of compoundExtensions) {
    if (name.endsWith(extension)) return name.slice(0, -extension.length)
  }

  const lastDot = name.lastIndexOf('.')
  return lastDot >= 0 ? name.slice(0, lastDot) : name
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, String(value))
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => {
      storage.clear()
    },
  },
})

describe('basenameNoExt', () => {
  it('strips .tar.gz compound extension', () => {
    expect(basenameNoExt('archive.tar.gz')).toBe('archive')
  })

  it('strips .tar.bz2 compound extension', () => {
    expect(basenameNoExt('backup.tar.bz2')).toBe('backup')
  })

  it('strips .tar.xz compound extension', () => {
    expect(basenameNoExt('data.tar.xz')).toBe('data')
  })

  it('strips single extension', () => {
    expect(basenameNoExt('model.gguf')).toBe('model')
  })

  it('handles full path with directory', () => {
    expect(basenameNoExt('/path/to/archive.tar.gz')).toBe('archive')
  })

  it('handles filename without extension', () => {
    expect(basenameNoExt('README')).toBe('README')
  })

  it('handles complex filenames with multiple dots', () => {
    expect(basenameNoExt('llama-b1234-bin-cuda.tar.gz')).toBe('llama-b1234-bin-cuda')
  })

  it('handles filename with single dot', () => {
    expect(basenameNoExt('file.txt')).toBe('file')
  })
})

describe('getProxyConfig', () => {
  beforeEach(() => {
    localStorage.clear()
    invokeMock.mockResolvedValue(null)
  })

  it('returns null when no proxy config is stored', async () => {
    expect(await getProxyConfig()).toBeNull()
  })

  it('returns null when proxy is disabled', async () => {
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({ enabled: false, host: 'proxy.example.com', port: 8080 })
    )
    expect(await getProxyConfig()).toBeNull()
  })

  it('returns null when host is missing', async () => {
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({ enabled: true, host: '', port: 8080 })
    )
    expect(await getProxyConfig()).toBeNull()
  })

  it('returns proxy config when enabled with valid host', async () => {
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({ enabled: true, host: 'proxy.local', port: 3128 })
    )
    const config = await getProxyConfig()
    expect(config).not.toBeNull()
    expect(config!.host).toBe('proxy.local')
    expect(config!.port).toBe(3128)
  })

  it('defaults port to 8080 when invalid', async () => {
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({ enabled: true, host: 'proxy.local', port: 'invalid' })
    )
    const config = await getProxyConfig()
    expect(config!.port).toBe(8080)
  })

  it('accepts decimal string ports', async () => {
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({ enabled: true, host: 'proxy.local', port: '3128' })
    )
    const config = await getProxyConfig()
    expect(config!.port).toBe(3128)
  })

  it('rejects non-decimal and out-of-range proxy ports', async () => {
    for (const port of ['0x10', '1e3', '8080.5', 0, 65536, Infinity]) {
      localStorage.setItem(
        'setting-proxy-config',
        JSON.stringify({ enabled: true, host: 'proxy.local', port })
      )
      expect((await getProxyConfig())!.port).toBe(8080)
    }
  })

  it('returns null for invalid JSON', async () => {
    localStorage.setItem('setting-proxy-config', 'not-json')
    expect(await getProxyConfig()).toBeNull()
  })

  it('includes optional fields when present', async () => {
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({
        enabled: true,
        host: 'proxy.local',
        port: 8080,
        user: 'admin',
        password: 'secret',
        https: true,
        noVerify: true,
      })
    )
    const config = await getProxyConfig()
    expect(config!.user).toBe('admin')
    expect(config!.password).toBe('secret')
    expect(config!.https).toBe(true)
    expect(config!.noVerify).toBe(true)
  })

  it('parses boolean-like proxy flags without treating false strings as true', async () => {
    for (const [https, noVerify, expectedHttps, expectedNoVerify] of [
      ['true', '1', true, true],
      ['false', '0', false, false],
      ['', 'yes', false, false],
      [1, 0, true, false],
    ] as const) {
      localStorage.setItem(
        'setting-proxy-config',
        JSON.stringify({
          enabled: true,
          host: 'proxy.local',
          port: 8080,
          https,
          noVerify,
        })
      )
      const config = await getProxyConfig()
      expect(config!.https).toBe(expectedHttps)
      expect(config!.noVerify).toBe(expectedNoVerify)
    }
  })

  it('reads the current Zustand shape and retrieves password from secure storage', async () => {
    invokeMock.mockResolvedValue('credential-store-secret')
    localStorage.setItem(
      'setting-proxy-config',
      JSON.stringify({
        state: {
          proxyEnabled: true,
          proxyUrl: 'https://proxy.example.com:8443',
          proxyUsername: 'alice',
          proxyPassword: '',
          proxyIgnoreSSL: true,
          noProxy: 'localhost, *.internal',
        },
        version: 0,
      })
    )

    await expect(getProxyConfig()).resolves.toEqual({
      host: 'proxy.example.com',
      port: 8443,
      user: 'alice',
      password: 'credential-store-secret',
      https: true,
      noVerify: true,
      noProxy: ['localhost', '*.internal'],
    })
    expect(invokeMock).toHaveBeenCalledWith('get_secret', {
      key: 'proxy-password',
    })
  })
})

describe('buildProxyArg', () => {
  it('returns null when proxy is null', () => {
    expect(buildProxyArg(null)).toBeNull()
  })

  it('builds http URL by default', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 8080 })
    expect(result).not.toBeNull()
    expect(result!.url).toBe('http://proxy.local:8080')
  })

  it('builds https URL when https is true', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 443, https: true })
    expect(result!.url).toBe('https://proxy.local')
  })

  it('includes username when provided', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 8080, user: 'admin' })
    expect(result!.username).toBe('admin')
  })

  it('keeps credentials out of the proxy URL and in dedicated fields', () => {
    const result = buildProxyArg({
      host: 'proxy.local',
      port: 8080,
      user: 'admin',
      password: 'secret with space',
    })
    expect(result!.url).toBe('http://proxy.local:8080')
    expect(result!.username).toBe('admin')
    expect(result!.password).toBe('secret with space')
  })

  it('includes password when provided', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 8080, password: 'secret' })
    expect(result!.password).toBe('secret')
  })

  it('includes ignore_ssl when noVerify is true', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 8080, noVerify: true })
    expect(result!.ignore_ssl).toBe(true)
  })

  it('does not include ignore_ssl when noVerify is false', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 8080, noVerify: false })
    expect(result!.ignore_ssl).toBeUndefined()
  })

  it('does not include username/password when not provided', () => {
    const result = buildProxyArg({ host: 'proxy.local', port: 8080 })
    expect(result!.username).toBeUndefined()
    expect(result!.password).toBeUndefined()
  })

  it('pairs partial credentials and forwards no_proxy entries', () => {
    const result = buildProxyArg({
      host: 'proxy.local',
      port: 8080,
      user: 'admin',
      noProxy: ['localhost', '*.internal'],
    })
    expect(result).toMatchObject({
      url: 'http://proxy.local:8080',
      username: 'admin',
      password: '',
      no_proxy: ['localhost', '*.internal'],
    })
  })

  it('rejects malformed proxy hosts instead of constructing an ambiguous URL', () => {
    for (const host of [
      'user:secret@proxy.local/path',
      'proxy.local/path',
      'proxy.local?target=other',
      'proxy.local#fragment',
    ]) {
      expect(buildProxyArg({ host, port: 8080 })).toBeNull()
    }
  })
})

describe('estimateTokensFromText', () => {
  it('estimates tokens using default chars-per-token of 3', () => {
    expect(estimateTokensFromText('hello')).toBe(2) // ceil(5/3) = 2
  })

  it('uses custom chars-per-token', () => {
    expect(estimateTokensFromText('hello world', 4)).toBe(3) // ceil(11/4) = 3
  })

  it('handles empty string', () => {
    expect(estimateTokensFromText('')).toBe(0)
  })

  it('rounds up partial tokens', () => {
    expect(estimateTokensFromText('ab')).toBe(1) // ceil(2/3) = 1
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to the default for invalid chars-per-token %s',
    (charsPerToken) => {
      expect(estimateTokensFromText('hello', charsPerToken)).toBe(2)
    }
  )
})

describe('createRandomApiSecret', () => {
  it('returns independent 256-bit hexadecimal secrets', () => {
    const first = createRandomApiSecret()
    const second = createRandomApiSecret()

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toMatch(/^[a-f0-9]{64}$/)
    expect(first).not.toBe(second)
  })
})

describe('buildEmbedBatches', () => {
  it('returns empty array for empty inputs', () => {
    expect(buildEmbedBatches([], 512)).toEqual([])
  })

  it('puts all inputs in one batch when under safe limit', () => {
    const inputs = ['hello', 'world']
    const batches = buildEmbedBatches(inputs, 512)
    expect(batches).toHaveLength(1)
    expect(batches[0].inputs).toEqual(['hello', 'world'])
    expect(batches[0].startIndex).toBe(0)
  })

  it('splits inputs into multiple batches when exceeding safe limit', () => {
    // Safe limit = floor(10 * 0.5) = 5 tokens
    // Each 15-char string ~ 5 tokens (ceil(15/3) = 5)
    const inputs = ['a'.repeat(15), 'b'.repeat(15), 'c'.repeat(15)]
    const batches = buildEmbedBatches(inputs, 10)
    expect(batches.length).toBeGreaterThan(1)
  })

  it('preserves start indices across batches', () => {
    // Force small batch size
    const inputs = ['a'.repeat(15), 'b'.repeat(15)]
    const batches = buildEmbedBatches(inputs, 10)
    expect(batches[0].startIndex).toBe(0)
    if (batches.length > 1) {
      expect(batches[1].startIndex).toBeGreaterThan(0)
    }
  })

  it('handles single very large input', () => {
    const inputs = ['a'.repeat(3000)]
    const batches = buildEmbedBatches(inputs, 512)
    // Should still produce at least one batch with the input
    expect(batches).toHaveLength(1)
    expect(batches[0].inputs).toHaveLength(1)
  })
})

describe('mergeEmbedResponses', () => {
  it('merges multiple batch results into one response', () => {
    const batchResults = [
      {
        data: [{ embedding: [0.1, 0.2], index: 0, object: 'embedding' }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      },
      {
        data: [{ embedding: [0.3, 0.4], index: 0, object: 'embedding' }],
        usage: { prompt_tokens: 3, total_tokens: 3 },
      },
    ]

    const result = mergeEmbedResponses('test-model', batchResults)

    expect(result.model).toBe('test-model')
    expect(result.object).toBe('list')
    expect(result.usage.prompt_tokens).toBe(8)
    expect(result.usage.total_tokens).toBe(8)
    expect(result.data).toHaveLength(2)
    // Re-indexed sequentially
    expect(result.data[0].index).toBe(0)
    expect(result.data[1].index).toBe(1)
    expect(result.data[0].embedding).toEqual([0.1, 0.2])
    expect(result.data[1].embedding).toEqual([0.3, 0.4])
  })

  it('handles empty batch results', () => {
    const result = mergeEmbedResponses('model', [])
    expect(result.data).toEqual([])
    expect(result.usage.prompt_tokens).toBe(0)
    expect(result.usage.total_tokens).toBe(0)
  })

  it('handles batch results with missing usage', () => {
    const batchResults = [
      {
        data: [{ embedding: [0.1], index: 0, object: 'embedding' }],
        usage: undefined as any,
      },
    ]
    const result = mergeEmbedResponses('model', batchResults)
    expect(result.usage.prompt_tokens).toBe(0)
    expect(result.data).toHaveLength(1)
  })
})

describe('parseSimpleYaml', () => {
  it('parses key-value pairs', () => {
    const result = parseSimpleYaml('name: my-model\nsize: 1024')
    expect(result.name).toBe('my-model')
    expect(result.size).toBe(1024)
  })

  it('parses quoted string values', () => {
    const result = parseSimpleYaml('path: "/home/user/model.gguf"')
    expect(result.path).toBe('/home/user/model.gguf')
  })

  it('parses single-quoted string values', () => {
    const result = parseSimpleYaml("name: 'my model'")
    expect(result.name).toBe('my model')
  })

  it('parses boolean true', () => {
    const result = parseSimpleYaml('embedding: true')
    expect(result.embedding).toBe(true)
  })

  it('parses boolean false', () => {
    const result = parseSimpleYaml('enabled: false')
    expect(result.enabled).toBe(false)
  })

  it('parses numeric values', () => {
    const result = parseSimpleYaml('count: 42\npi: 3.14')
    expect(result.count).toBe(42)
    expect(result.pi).toBe(3.14)
  })

  it('parses signed and exponent decimal numbers', () => {
    const result = parseSimpleYaml('negative: -3\nsmall: 1e-3\nfraction: .5')
    expect(result.negative).toBe(-3)
    expect(result.small).toBe(0.001)
    expect(result.fraction).toBe(0.5)
  })

  it('keeps non-decimal and non-finite scalar values as strings', () => {
    const result = parseSimpleYaml([
      'hex: 0x10',
      'infinity: Infinity',
      'nan: NaN',
      'blank: ',
    ].join('\n'))

    expect(result.hex).toBe('0x10')
    expect(result.infinity).toBe('Infinity')
    expect(result.nan).toBe('NaN')
    expect(result.blank).toBe('')
  })

  it('skips empty lines', () => {
    const result = parseSimpleYaml('a: 1\n\nb: 2')
    expect(result.a).toBe(1)
    expect(result.b).toBe(2)
  })

  it('skips comment lines', () => {
    const result = parseSimpleYaml('# this is a comment\nkey: value')
    expect(result.key).toBe('value')
    expect(Object.keys(result)).toHaveLength(1)
  })

  it('handles lines without colon', () => {
    const result = parseSimpleYaml('no-colon-here')
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('handles empty string values', () => {
    const result = parseSimpleYaml('key: ')
    expect(result.key).toBe('')
  })

  it('handles colons in values', () => {
    const result = parseSimpleYaml('url: http://localhost:8080')
    expect(result.url).toBe('http://localhost:8080')
  })

  it('parses nested objects and arrays', () => {
    const result = parseSimpleYaml([
      'model:',
      '  name: "demo"',
      '  tags:',
      '    - "vision"',
      '    - "chat"',
    ].join('\n'))

    expect(result.model).toEqual({
      name: 'demo',
      tags: ['vision', 'chat'],
    })
  })

  it('parses block scalar values', () => {
    const result = parseSimpleYaml([
      'prompt: |',
      '  first line',
      '  second line',
    ].join('\n'))

    expect(result.prompt).toBe('first line\nsecond line')
  })
})

describe('toSimpleYaml', () => {
  it('serializes string values with quotes', () => {
    const result = toSimpleYaml({ name: 'my-model' })
    expect(result).toBe('name: "my-model"\n')
  })

  it('serializes number values without quotes', () => {
    const result = toSimpleYaml({ size: 1024 })
    expect(result).toBe('size: 1024\n')
  })

  it('serializes boolean values without quotes', () => {
    const result = toSimpleYaml({ enabled: true })
    expect(result).toBe('enabled: true\n')
  })

  it('skips undefined values', () => {
    const result = toSimpleYaml({ a: 'yes', b: undefined })
    expect(result).toBe('a: "yes"\n')
  })

  it('handles multiple entries', () => {
    const result = toSimpleYaml({ name: 'test', size: 100, active: false })
    expect(result).toContain('name: "test"')
    expect(result).toContain('size: 100')
    expect(result).toContain('active: false')
    expect(result.endsWith('\n')).toBe(true)
  })

  it('handles empty object', () => {
    const result = toSimpleYaml({})
    expect(result).toBe('\n')
  })

  it('serializes nested objects and arrays', () => {
    const result = toSimpleYaml({
      model: {
        name: 'demo',
        tags: ['vision', 'chat'],
      },
    })

    expect(result).toContain('model:')
    expect(result).toContain('  name: "demo"')
    expect(result).toContain('  tags:')
    expect(result).toContain('    - "vision"')
    expect(result).toContain('    - "chat"')
  })

  it('serializes multiline strings as block scalars', () => {
    const result = toSimpleYaml({ prompt: 'first line\nsecond line' })

    expect(result).toBe('prompt: |\n  first line\n  second line\n')
  })
})

describe('sleep', () => {
  it('resolves after specified duration', async () => {
    vi.useFakeTimers()
    const promise = sleep(100)
    vi.advanceTimersByTime(100)
    await promise
    vi.useRealTimers()
    // If we reach here without timeout, sleep resolved correctly
    expect(true).toBe(true)
  })
})
