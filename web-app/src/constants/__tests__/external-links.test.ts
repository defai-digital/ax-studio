import { describe, expect, it } from 'vitest'

import { AX_STUDIO_EXTERNAL_LINKS } from '../external-links'

describe('AX_STUDIO_EXTERNAL_LINKS', () => {
  it('uses valid HTTPS URLs', () => {
    for (const value of Object.values(AX_STUDIO_EXTERNAL_LINKS)) {
      expect(new URL(value).protocol).toBe('https:')
    }
  })

  it('points project links at the current repository', () => {
    expect(AX_STUDIO_EXTERNAL_LINKS.repository).toBe(
      'https://github.com/defai-digital/ax-studio',
    )
    expect(AX_STUDIO_EXTERNAL_LINKS.issueChooser).toContain(
      'github.com/defai-digital/ax-studio/issues/',
    )
    expect(AX_STUDIO_EXTERNAL_LINKS.aiContentReport).toContain(
      'template=ai-content-report.yml',
    )
  })
})
