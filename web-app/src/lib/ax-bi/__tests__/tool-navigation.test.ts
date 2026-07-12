import { describe, expect, it } from 'vitest'
import {
  getAxBiResultUrl,
  normalizeAxBiResultUrl,
  parseAxBiToolResult,
} from '../tool-navigation'

describe('AX BI tool navigation helpers', () => {
  it('parses structured AX BI JSON results from MCP text content', () => {
    const parsed = parseAxBiToolResult({
      content: [
        {
          text: JSON.stringify({
            success: true,
            explore_url: 'http://127.0.0.1:8088/explore/p/abc/',
          }),
        },
      ],
    })

    expect(parsed).toEqual({
      success: true,
      explore_url: 'http://127.0.0.1:8088/explore/p/abc/',
    })
    expect(getAxBiResultUrl('generate_chart', parsed!)).toBe(
      'http://127.0.0.1:8088/explore/p/abc/'
    )
  })

  it('does not auto-open discovery tool URLs', () => {
    expect(
      getAxBiResultUrl('get_dataset_info', {
        success: true,
        url: 'http://127.0.0.1:8088/explore/?datasource_type=table&datasource_id=20',
      })
    ).toBeUndefined()
  })

  it('opens prompt-to-dashboard results', () => {
    expect(
      getAxBiResultUrl('prompt_to_dashboard', {
        dashboard_url: 'http://127.0.0.1:8088/ax-bi/dashboard/12/',
      })
    ).toBe('http://127.0.0.1:8088/ax-bi/dashboard/12/')
  })

  it('rewrites retired Superset dashboard routes to AX BI routes', () => {
    expect(
      normalizeAxBiResultUrl(
        'http://127.0.0.1:8088/superset/dashboard/8/?native_filters_key=abc#top'
      )
    ).toBe(
      'http://127.0.0.1:8088/ax-bi/dashboard/8/?native_filters_key=abc#top'
    )
    expect(normalizeAxBiResultUrl('/dashboard/12/')).toBe(
      'http://127.0.0.1:8088/ax-bi/dashboard/12/'
    )
  })

  it('keeps current explore routes and upgrades retired Superset explore routes', () => {
    expect(normalizeAxBiResultUrl('/explore/?slice_id=12')).toBe(
      'http://127.0.0.1:8088/explore/?slice_id=12'
    )
    expect(normalizeAxBiResultUrl('/superset/explore/?slice_id=12')).toBe(
      'http://127.0.0.1:8088/explore/?slice_id=12'
    )
  })

  it('rejects non-HTTP result URLs', () => {
    expect(normalizeAxBiResultUrl('javascript:alert(1)')).toBeUndefined()
  })
})
