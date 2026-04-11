import { describe, it, expect, vi } from 'vitest'
import {
  sanitizeModelId,
  extractThinkingContent,
  basenameNoExt,
  getProviderColor,
  getProviderDescription,
  cn,
  isDev,
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

describe('extractThinkingContent', () => {
  it('removes <think> tags', () => {
    expect(extractThinkingContent('<think>some thought</think>')).toBe(
      'some thought'
    )
  })

  it('removes opening think tag only', () => {
    expect(extractThinkingContent('<think>partial')).toBe('partial')
  })

  it('removes closing think tag only', () => {
    expect(extractThinkingContent('partial</think>')).toBe('partial')
  })

  it('removes channel|message analysis markers', () => {
    expect(
      extractThinkingContent('<|channel|>analysis<|message|>')
    ).toBe('')
  })

  it('removes start|assistant|channel|final|message markers', () => {
    expect(
      extractThinkingContent(
        '<|start|>assistant<|channel|>final<|message|>'
      )
    ).toBe('')
  })

  it('removes assistant|channel|final|message without start', () => {
    expect(
      extractThinkingContent('assistant<|channel|>final<|message|>')
    ).toBe('')
  })

  it('removes remaining channel markers', () => {
    expect(extractThinkingContent('text<|channel|>more')).toBe('textmore')
  })

  it('removes remaining message markers', () => {
    expect(extractThinkingContent('text<|message|>more')).toBe('textmore')
  })

  it('removes remaining start markers', () => {
    expect(extractThinkingContent('text<|start|>more')).toBe('textmore')
  })

  it('trims whitespace from result', () => {
    expect(extractThinkingContent('  hello  ')).toBe('hello')
    expect(extractThinkingContent('<think>  hello  </think>')).toBe('hello')
  })

  it('handles empty string', () => {
    expect(extractThinkingContent('')).toBe('')
  })

  it('returns text unchanged when no markers present', () => {
    expect(extractThinkingContent('plain text here')).toBe('plain text here')
  })

  it('handles multiple think tags', () => {
    expect(
      extractThinkingContent('<think>a</think> middle <think>b</think>')
    ).toBe('a middle b')
  })

  it('handles combined markers in realistic content', () => {
    const input =
      '<think>Let me analyze this</think><|channel|>analysis<|message|>Here is the answer'
    expect(extractThinkingContent(input)).toBe(
      'Let me analyze thisHere is the answer'
    )
  })

  it('is idempotent on clean text', () => {
    const clean = 'already clean text'
    expect(extractThinkingContent(clean)).toBe(clean)
    expect(extractThinkingContent(extractThinkingContent(clean))).toBe(clean)
  })
})

describe('basenameNoExt', () => {
  it('removes simple file extension', () => {
    expect(basenameNoExt('file.txt')).toBe('file')
  })

  it('removes .tar.gz extension', () => {
    expect(basenameNoExt('archive.tar.gz')).toBe('archive')
  })

  it('removes .zip extension', () => {
    expect(basenameNoExt('archive.zip')).toBe('archive')
  })

  it('handles file path with directories', () => {
    expect(basenameNoExt('/home/user/file.txt')).toBe('file')
  })

  it('handles .tar.gz in full path', () => {
    expect(basenameNoExt('/downloads/data.tar.gz')).toBe('data')
  })

  it('handles multiple dots in filename', () => {
    expect(basenameNoExt('my.file.name.ts')).toBe('my.file.name')
  })

  it('handles dotfile with extension', () => {
    expect(basenameNoExt('.gitignore.bak')).toBe('.gitignore')
  })

  it('handles .tar.gz case insensitive match', () => {
    expect(basenameNoExt('ARCHIVE.TAR.GZ')).toBe('ARCHIVE')
  })

  it('handles .ZIP case insensitive match', () => {
    expect(basenameNoExt('FILE.ZIP')).toBe('FILE')
  })

  // Regression: path.extname('Makefile') === '', and
  // `base.slice(0, -''.length)` collapses to `base.slice(0, 0)` which
  // returns ''. The implementation now guards against the empty-ext case
  // and returns the full basename instead.
  it('returns the full basename for extensionless files', () => {
    expect(basenameNoExt('Makefile')).toBe('Makefile')
    expect(basenameNoExt('README')).toBe('README')
    expect(basenameNoExt('LICENSE')).toBe('LICENSE')
  })

  it('returns the full basename for dotfiles (Node treats them as no extension)', () => {
    // `path.extname('.gitignore')` is '' in Node — dotfiles are not
    // considered to have an extension.
    expect(basenameNoExt('.gitignore')).toBe('.gitignore')
  })

  it('handles file with just an extension-like name', () => {
    expect(basenameNoExt('test.js')).toBe('test')
  })

  it('handles deeply nested paths', () => {
    expect(basenameNoExt('/a/b/c/d/e/file.ts')).toBe('file')
  })

  it('prioritizes .tar.gz over .gz', () => {
    // .tar.gz is checked first as a valid compound extension
    expect(basenameNoExt('data.tar.gz')).toBe('data')
  })

  it('handles .gz files that are not .tar.gz', () => {
    // Only .gz, not .tar.gz — falls through to normal extname removal
    expect(basenameNoExt('file.gz')).toBe('file')
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

  it('returns correct color for mistral', () => {
    expect(getProviderColor('mistral')).toBe('#ff7000')
  })

  it('returns correct color for openrouter', () => {
    expect(getProviderColor('openrouter')).toBe('#6366f1')
  })

  it('returns correct color for huggingface', () => {
    expect(getProviderColor('huggingface')).toBe('#ffcc00')
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
      'openai', 'anthropic', 'gemini', 'groq', 'mistral',
      'openrouter', 'huggingface', 'azure', 'cohere', 'unknown',
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

  it('returns correct description for mistral', () => {
    expect(getProviderDescription('mistral')).toBe('Mistral Large, Codestral')
  })

  it('returns correct description for openrouter', () => {
    expect(getProviderDescription('openrouter')).toBe(
      'Multi-provider API gateway'
    )
  })

  it('returns correct description for huggingface', () => {
    expect(getProviderDescription('huggingface')).toBe('Open-source model hub')
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
