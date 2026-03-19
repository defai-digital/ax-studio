import { describe, it, expect } from 'vitest'
import {
  INTEGRATIONS,
  getIntegration,
  type Integration,
  type IntegrationField,
} from '../integrations-registry'

describe('INTEGRATIONS constant', () => {
  it('contains all expected integrations', () => {
    const ids = INTEGRATIONS.map((i) => i.id)
    expect(ids).toEqual([
      'linear',
      'notion',
      'slack',
      'jira',
      'gitlab',
      'sentry',
      'todoist',
      'postgres',
      'google-workspace',
    ])
  })

  it('has exactly 9 integrations', () => {
    expect(INTEGRATIONS).toHaveLength(9)
  })

  it('has unique IDs across all integrations', () => {
    const ids = INTEGRATIONS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every integration has the required shape', () => {
    for (const integration of INTEGRATIONS) {
      expect(typeof integration.id).toBe('string')
      expect(integration.id.length).toBeGreaterThan(0)
      expect(typeof integration.name).toBe('string')
      expect(typeof integration.description).toBe('string')
      expect(typeof integration.icon).toBe('string')
      expect(integration.icon).toMatch(/^\/icons\/integrations\//)
      expect(['development', 'project-management', 'communication', 'productivity']).toContain(
        integration.category
      )
      expect(typeof integration.mcpPackage).toBe('string')
      expect(typeof integration.mcpCommand).toBe('string')
      expect(Array.isArray(integration.mcpArgs)).toBe(true)
      expect(Array.isArray(integration.fields)).toBe(true)
      expect(integration.fields.length).toBeGreaterThan(0)
    }
  })

  it('every field has the required shape', () => {
    for (const integration of INTEGRATIONS) {
      for (const field of integration.fields) {
        expect(typeof field.key).toBe('string')
        expect(field.key.length).toBeGreaterThan(0)
        expect(typeof field.label).toBe('string')
        expect(['password', 'text', 'url']).toContain(field.type)
        expect(typeof field.placeholder).toBe('string')
        if (field.docsUrl !== undefined) {
          expect(field.docsUrl).toMatch(/^https:\/\//)
        }
      }
    }
  })

  it('all mcpArgs arrays start with -y flag', () => {
    for (const integration of INTEGRATIONS) {
      expect(integration.mcpArgs[0]).toBe('-y')
    }
  })

  describe('category distribution', () => {
    it('has development integrations', () => {
      const dev = INTEGRATIONS.filter((i) => i.category === 'development')
      expect(dev.length).toBeGreaterThan(0)
      const devIds = dev.map((i) => i.id)
      expect(devIds).toContain('gitlab')
      expect(devIds).toContain('sentry')
      expect(devIds).toContain('postgres')
    })

    it('has project-management integrations', () => {
      const pm = INTEGRATIONS.filter((i) => i.category === 'project-management')
      expect(pm.map((i) => i.id)).toEqual(
        expect.arrayContaining(['linear', 'jira'])
      )
    })

    it('has communication integrations', () => {
      const comm = INTEGRATIONS.filter((i) => i.category === 'communication')
      expect(comm.map((i) => i.id)).toContain('slack')
    })

    it('has productivity integrations', () => {
      const prod = INTEGRATIONS.filter((i) => i.category === 'productivity')
      expect(prod.map((i) => i.id)).toEqual(
        expect.arrayContaining(['notion', 'todoist', 'google-workspace'])
      )
    })
  })

  describe('specific integrations', () => {
    it('linear has correct configuration', () => {
      const linear = INTEGRATIONS.find((i) => i.id === 'linear')!
      expect(linear.name).toBe('Linear')
      expect(linear.mcpCommand).toBe('npx')
      expect(linear.mcpPackage).toBe('linear-mcp-server')
      expect(linear.fields).toHaveLength(1)
      expect(linear.fields[0].key).toBe('LINEAR_API_KEY')
      expect(linear.fields[0].type).toBe('password')
    })

    it('jira has multiple fields', () => {
      const jira = INTEGRATIONS.find((i) => i.id === 'jira')!
      expect(jira.fields).toHaveLength(3)
      const keys = jira.fields.map((f) => f.key)
      expect(keys).toEqual([
        'ATLASSIAN_SITE_NAME',
        'ATLASSIAN_USER_EMAIL',
        'ATLASSIAN_API_TOKEN',
      ])
    })

    it('gitlab has optional API URL field', () => {
      const gitlab = INTEGRATIONS.find((i) => i.id === 'gitlab')!
      expect(gitlab.fields).toHaveLength(2)
      const urlField = gitlab.fields.find((f) => f.key === 'GITLAB_API_URL')!
      expect(urlField.type).toBe('url')
      expect(urlField.label).toContain('optional')
    })

    it('google-workspace uses oauth2 auth type', () => {
      const gw = INTEGRATIONS.find((i) => i.id === 'google-workspace')!
      expect(gw.authType).toBe('oauth2')
      expect(gw.fields).toHaveLength(2)
    })

    it('integrations without authType have undefined authType', () => {
      const nonOauth = INTEGRATIONS.filter(
        (i) => i.id !== 'google-workspace'
      )
      for (const integration of nonOauth) {
        expect(integration.authType).toBeUndefined()
      }
    })

    it('google-workspace mcpArgs includes serve subcommand', () => {
      const gw = INTEGRATIONS.find((i) => i.id === 'google-workspace')!
      expect(gw.mcpArgs).toContain('serve')
    })
  })
})

describe('getIntegration', () => {
  it('returns the correct integration for a known id', () => {
    const linear = getIntegration('linear')
    expect(linear).toBeDefined()
    expect(linear!.id).toBe('linear')
    expect(linear!.name).toBe('Linear')
  })

  it('returns undefined for an unknown id', () => {
    expect(getIntegration('nonexistent')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(getIntegration('')).toBeUndefined()
  })

  it('is case-sensitive', () => {
    expect(getIntegration('Linear')).toBeUndefined()
    expect(getIntegration('LINEAR')).toBeUndefined()
    expect(getIntegration('linear')).toBeDefined()
  })

  it('returns all integrations correctly by id', () => {
    const allIds = [
      'linear',
      'notion',
      'slack',
      'jira',
      'gitlab',
      'sentry',
      'todoist',
      'postgres',
      'google-workspace',
    ]
    for (const id of allIds) {
      const result = getIntegration(id)
      expect(result).toBeDefined()
      expect(result!.id).toBe(id)
    }
  })

  it('returns the same object reference as in INTEGRATIONS array', () => {
    const fromGet = getIntegration('slack')
    const fromArray = INTEGRATIONS.find((i) => i.id === 'slack')
    expect(fromGet).toBe(fromArray)
  })

  it('does not match partial ids', () => {
    expect(getIntegration('lin')).toBeUndefined()
    expect(getIntegration('google')).toBeUndefined()
    expect(getIntegration('post')).toBeUndefined()
  })

  it('does not match ids with extra whitespace', () => {
    expect(getIntegration(' linear')).toBeUndefined()
    expect(getIntegration('linear ')).toBeUndefined()
    expect(getIntegration(' linear ')).toBeUndefined()
  })
})
