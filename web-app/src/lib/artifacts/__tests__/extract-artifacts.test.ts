import { describe, it, expect } from 'vitest'
import {
  extractArtifacts,
  extractArtifactsFromTextParts,
  stripThinkBlocks,
  MIN_CODE_LINES,
  MAX_ARTIFACTS_PER_MESSAGE,
} from '../extract-artifacts'

const lines = (n: number, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n')

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``

describe('stripThinkBlocks', () => {
  it('removes a closed think block', () => {
    expect(stripThinkBlocks('<think>secret</think>visible')).toBe('visible')
  })

  it('removes multiple closed think blocks', () => {
    expect(stripThinkBlocks('<think>a</think>mid<think>b</think>end')).toBe(
      'midend'
    )
  })

  it('truncates at an unclosed think tag (still reasoning)', () => {
    expect(stripThinkBlocks('before<think>still thinking')).toBe('before')
  })

  it('handles think tags with attributes, case-insensitively', () => {
    expect(stripThinkBlocks('<THINK data-x="1">a</THINK>b')).toBe('b')
  })

  it('returns text without think blocks unchanged', () => {
    expect(stripThinkBlocks('plain text')).toBe('plain text')
  })
})

describe('extractArtifacts', () => {
  it('detects a code block at exactly the 15-line threshold', () => {
    const md = fence('python', lines(MIN_CODE_LINES))
    const artifacts = extractArtifacts('m1', md)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      id: 'm1:0',
      messageId: 'm1',
      kind: 'code',
      language: 'python',
      lineCount: MIN_CODE_LINES,
    })
  })

  it('ignores a code block one line below the threshold', () => {
    const md = fence('python', lines(MIN_CODE_LINES - 1))
    expect(extractArtifacts('m1', md)).toHaveLength(0)
  })

  it('detects language-less fences at the threshold as code', () => {
    const md = fence('', lines(MIN_CODE_LINES))
    const artifacts = extractArtifacts('m1', md)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('code')
    expect(artifacts[0].language).toBe('')
  })

  it.each([
    ['html', 'html'],
    ['svg', 'svg'],
    ['mermaid', 'mermaid'],
  ] as const)('detects %s blocks of any length as kind %s', (lang, kind) => {
    const artifacts = extractArtifacts('m1', fence(lang, 'x'))
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe(kind)
    expect(artifacts[0].lineCount).toBe(1)
  })

  it('normalizes language casing and extra info-string tokens', () => {
    const artifacts = extractArtifacts('m1', fence('HTML {1}', '<p>hi</p>'))
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('html')
    expect(artifacts[0].language).toBe('html')
  })

  it('strips think blocks before detection', () => {
    const md = `<think>${fence('html', '<p>hidden</p>')}</think>${fence('html', '<p>shown</p>')}`
    const artifacts = extractArtifacts('m1', md)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].content).toBe('<p>shown</p>')
    // blockIndex counts fenced blocks after think-stripping, so this is 0
    expect(artifacts[0].id).toBe('m1:0')
  })

  it('ignores an unclosed fence (mid-stream)', () => {
    const md = `\`\`\`html\n<p>incomplete</p>`
    expect(extractArtifacts('m1', md)).toHaveLength(0)
  })

  it('still detects earlier closed fences when a later fence is unclosed', () => {
    const md = `${fence('html', '<p>done</p>')}\n\`\`\`python\npartial`
    const artifacts = extractArtifacts('m1', md)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('html')
  })

  it('detects multiple blocks and keeps the fenced-block index in ids', () => {
    const md = [
      fence('js', lines(3)), // below threshold — not an artifact
      fence('html', '<p>a</p>'),
      'some text',
      fence('python', lines(20)),
    ].join('\n')
    const artifacts = extractArtifacts('m1', md)
    expect(artifacts.map((a) => a.id)).toEqual(['m1:1', 'm1:2'])
    expect(artifacts.map((a) => a.kind)).toEqual(['html', 'code'])
  })

  it(`caps artifacts at MAX_ARTIFACTS_PER_MESSAGE (${MAX_ARTIFACTS_PER_MESSAGE})`, () => {
    const md = Array.from({ length: 8 }, (_, i) =>
      fence('html', `<p>${i}</p>`)
    ).join('\n')
    const artifacts = extractArtifacts('m1', md)
    expect(artifacts).toHaveLength(MAX_ARTIFACTS_PER_MESSAGE)
    expect(artifacts.map((a) => a.id)).toEqual([
      'm1:0',
      'm1:1',
      'm1:2',
      'm1:3',
      'm1:4',
    ])
  })

  it('does not count trailing blank lines toward the threshold', () => {
    const body = `${lines(MIN_CODE_LINES - 1)}\n\n\n`
    const md = `\`\`\`python\n${body}\`\`\``
    expect(extractArtifacts('m1', md)).toHaveLength(0)
  })

  it('ignores inline code and non-fence backticks', () => {
    const md = 'Use ```inline``` code\n````not a fence opener line`'
    expect(extractArtifacts('m1', md)).toHaveLength(0)
  })

  it('ignores fences indented by more than 3 spaces', () => {
    const md = `    ${fence('html', '<p>x</p>').replace(/\n/g, '\n    ')}`
    expect(extractArtifacts('m1', md)).toHaveLength(0)
  })

  it('returns an empty array for text without fences', () => {
    expect(extractArtifacts('m1', 'just prose')).toEqual([])
  })

  it('preserves artifact content verbatim', () => {
    const body = '<div class="a">\n  <span>hi</span>\n</div>'
    const artifacts = extractArtifacts('m1', fence('html', body))
    expect(artifacts[0].content).toBe(body)
  })
})

describe('extractArtifactsFromTextParts', () => {
  it('joins text parts like MessageItem getFullTextContent', () => {
    const parts = [
      { type: 'text', text: 'intro' },
      { type: 'reasoning', text: 'ignored' },
      { type: 'text', text: fence('mermaid', 'graph TD; A-->B;') },
    ]
    const artifacts = extractArtifactsFromTextParts('m1', parts)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].kind).toBe('mermaid')
    expect(artifacts[0].id).toBe('m1:0')
  })

  it('finds artifacts split across text parts after the newline join', () => {
    const parts = [
      { type: 'text', text: '```html' },
      { type: 'text', text: '<p>across parts</p>\n```' },
    ]
    const artifacts = extractArtifactsFromTextParts('m1', parts)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].content).toBe('<p>across parts</p>')
  })

  it('returns empty for messages without text parts', () => {
    expect(
      extractArtifactsFromTextParts('m1', [{ type: 'reasoning', text: 'x' }])
    ).toEqual([])
  })
})
