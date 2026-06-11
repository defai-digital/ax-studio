import { describe, it, expect, vi } from 'vitest'
import {
  sanitizeModelId,
  getProviderColor,
  getProviderDescription,
  cn,
  isDev,
  basename,
  fileExtension,
} from '../utils'

describe('sanitizeModelId', () => {
  it('keeps alphanumeric characters unchanged', () => {
    expect(sanitizeModelId('gpt4o')).toBe('gpt4o')
    expect(sanitizeModelId('ABC123')).toBe('ABC123')
  })

  it('keeps slashes and dashes unchanged', () => {
    expect(sanitizeModelId('meta/llama-3')).toBe('meta/llama-3')
  })

  it('keeps underscores unchanged', () => {
    expect(sanitizeModelId('model_name')).toBe('model_name')
  })

  it('replaces dots with underscores', () => {
    expect(sanitizeModelId('gpt-4.0')).toBe('gpt-4_0')
    expect(sanitizeModelId('model.v2.1')).toBe('model_v2_1')
  })

  it('removes special characters', () => {
    expect(sanitizeModelId('model@name')).toBe('modelname')
    expect(sanitizeModelId('model#name')).toBe('modelname')
    expect(sanitizeModelId('model name')).toBe('modelname')
    expect(sanitizeModelId('model!name?')).toBe('modelname')
  })

  it('handles a complex real-world model ID', () => {
    expect(sanitizeModelId('anthropic/claude-3.5-sonnet')).toBe(
      'anthropic/claude-3_5-sonnet'
    )
  })

  it('handles empty string', () => {
    expect(sanitizeModelId('')).toBe('')
  })

  it('strips all characters when input is entirely special chars', () => {
    expect(sanitizeModelId('!@#$%^&*()')).toBe('')
  })

  it('handles string with only dots', () => {
    expect(sanitizeModelId('...')).toBe('___')
  })

  it('handles string with mixed valid and invalid characters', () => {
    expect(sanitizeModelId('a.b@c/d-e_f')).toBe('a_bc/d-e_f')
  })
})

describe('basename', () => {
  it('returns the final path segment for POSIX and Windows paths', () => {
    expect(basename('/home/user/file.txt')).toBe('file.txt')
    expect(basename('C:\\Users\\me\\file.txt')).toBe('file.txt')
  })

  it('ignores trailing separators', () => {
    expect(basename('/home/user/folder/')).toBe('folder')
  })
})

describe('fileExtension', () => {
  it('returns the lowercase extension without the dot', () => {
    expect(fileExtension('/home/user/File.PDF')).toBe('pdf')
  })

  it('returns an empty string for extensionless names, dotfiles, and trailing dots', () => {
    expect(fileExtension('Makefile')).toBe('')
    expect(fileExtension('.gitignore')).toBe('')
    expect(fileExtension('file.')).toBe('')
  })
})

describe('getProviderColor', () => {
  it('returns correct color for openai', () => {
    expect(getProviderColor('openai')).toBe('#10a37f')
  })

  it('returns correct color for anthropic', () => {
    expect(getProviderColor('anthropic')).toBe('#cc7e3a')
  })

  it('returns correct color for gemini', () => {
    expect(getProviderColor('gemini')).toBe('#4285f4')
  })

  it('returns correct color for groq', () => {
    expect(getProviderColor('groq')).toBe('#f97316')
  })

  it('returns correct color for openrouter', () => {
    expect(getProviderColor('openrouter')).toBe('#6366f1')
  })

  it('returns correct color for azure', () => {
    expect(getProviderColor('azure')).toBe('#0078d4')
  })

  it('returns correct color for cohere', () => {
    expect(getProviderColor('cohere')).toBe('#39594d')
  })

  it('returns gray default for unknown provider', () => {
    expect(getProviderColor('unknown')).toBe('#6b7280')
  })

  it('returns gray default for empty string', () => {
    expect(getProviderColor('')).toBe('#6b7280')
  })

  it('is case-sensitive — uppercase does not match', () => {
    expect(getProviderColor('OpenAI')).toBe('#6b7280')
  })

  it('all returned values are valid hex colors', () => {
    const providers = [
      'openai', 'anthropic', 'gemini', 'groq',
      'openrouter', 'azure', 'cohere', 'unknown',
    ]
    for (const p of providers) {
      expect(getProviderColor(p)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('getProviderDescription', () => {
  it('returns correct description for openai', () => {
    expect(getProviderDescription('openai')).toBe('GPT-4o, o1, and more')
  })

  it('returns correct description for anthropic', () => {
    expect(getProviderDescription('anthropic')).toBe('Claude 3.5, Claude 4')
  })

  it('returns correct description for gemini', () => {
    expect(getProviderDescription('gemini')).toBe('Gemini Pro and Ultra')
  })

  it('returns correct description for groq', () => {
    expect(getProviderDescription('groq')).toBe('Ultra-fast inference')
  })

  it('returns correct description for openrouter', () => {
    expect(getProviderDescription('openrouter')).toBe(
      'Multi-provider API gateway'
    )
  })

  it('returns correct description for azure', () => {
    expect(getProviderDescription('azure')).toBe('Azure OpenAI Service')
  })

  it('returns default description for unknown provider', () => {
    expect(getProviderDescription('unknown')).toBe('Custom model provider')
  })

  it('returns default description for empty string', () => {
    expect(getProviderDescription('')).toBe('Custom model provider')
  })

  it('does not have cohere in the switch (falls to default)', () => {
    expect(getProviderDescription('cohere')).toBe('Custom model provider')
  })
})

describe('cn', () => {
  it('merges simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes via clsx', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
    expect(cn('base', true && 'active')).toBe('base active')
  })

  it('handles undefined and null inputs', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end')
  })

  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('preserves non-conflicting tailwind classes', () => {
    const result = cn('p-4', 'mt-2', 'text-red-500')
    expect(result).toContain('p-4')
    expect(result).toContain('mt-2')
    expect(result).toContain('text-red-500')
  })

  it('handles empty arguments', () => {
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
  })

  it('handles array inputs via clsx', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('handles object inputs via clsx', () => {
    expect(cn({ active: true, hidden: false })).toBe('active')
  })
})

describe('isDev', () => {
  const originalLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })

  it('returns true when host starts with localhost:', () => {
    Object.defineProperty(window, 'location', {
      value: { host: 'localhost:5173' },
      writable: true,
      configurable: true,
    })
    expect(isDev()).toBe(true)
  })

  it('returns true for any localhost port', () => {
    Object.defineProperty(window, 'location', {
      value: { host: 'localhost:3000' },
      writable: true,
      configurable: true,
    })
    expect(isDev()).toBe(true)
  })

  it('returns false for production host', () => {
    Object.defineProperty(window, 'location', {
      value: { host: 'app.example.com' },
      writable: true,
      configurable: true,
    })
    expect(isDev()).toBe(false)
  })

  it('returns false for localhost without port (no colon)', () => {
    Object.defineProperty(window, 'location', {
      value: { host: 'localhost' },
      writable: true,
      configurable: true,
    })
    // 'localhost'.startsWith('localhost:') is false
    expect(isDev()).toBe(false)
  })

  it('returns false for tauri://localhost', () => {
    Object.defineProperty(window, 'location', {
      value: { host: 'tauri.localhost' },
      writable: true,
      configurable: true,
    })
    expect(isDev()).toBe(false)
  })
})
