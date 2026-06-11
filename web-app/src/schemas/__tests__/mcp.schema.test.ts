import { describe, it, expect } from 'vitest'
import {
  mcpServerConfigSchema,
  mcpServersSchema,
  mcpSettingsSchema,
} from '../mcp.schema'

describe('mcpServerConfigSchema', () => {
  it('should validate a minimal config (all optional)', () => {
    const result = mcpServerConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.command).toBe('')
      expect(result.data.args).toEqual([])
      expect(result.data.env).toEqual({})
    }
  })

  it('should validate a full stdio config', () => {
    const config = {
      command: '/usr/bin/node',
      args: ['server.js', '--port', '3000'],
      env: { NODE_ENV: 'production' },
      active: true,
      type: 'stdio' as const,
      timeout: 30000,
      official: false,
      managed: true,
    }
    const result = mcpServerConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.command).toBe('/usr/bin/node')
      expect(result.data.args).toEqual(['server.js', '--port', '3000'])
      expect(result.data.type).toBe('stdio')
    }
  })

  it('should validate an http config with url and headers', () => {
    const config = {
      type: 'http' as const,
      url: 'https://mcp.example.com/api',
      headers: { Authorization: 'Bearer token123' },
      active: true,
    }
    const result = mcpServerConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.url).toBe('https://mcp.example.com/api')
      expect(result.data.headers?.Authorization).toBe('Bearer token123')
    }
  })

  it('should validate an sse config', () => {
    const config = {
      type: 'sse' as const,
      url: 'https://mcp.example.com/sse',
    }
    const result = mcpServerConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('should fail when type is invalid enum', () => {
    const result = mcpServerConfigSchema.safeParse({ type: 'websocket' })
    expect(result.success).toBe(false)
  })

  it('should fail when args is not an array of strings', () => {
    const result = mcpServerConfigSchema.safeParse({ args: [1, 2, 3] })
    expect(result.success).toBe(false)
  })

  it('should fail when env values are not strings', () => {
    const result = mcpServerConfigSchema.safeParse({
      env: { KEY: 123 },
    })
    expect(result.success).toBe(false)
  })

  it('should fail when active is not a boolean', () => {
    const result = mcpServerConfigSchema.safeParse({ active: 'yes' })
    expect(result.success).toBe(false)
  })

  it('should fail when timeout is a string', () => {
    const result = mcpServerConfigSchema.safeParse({ timeout: '5000' })
    expect(result.success).toBe(false)
  })

  it('should accept integration field', () => {
    const result = mcpServerConfigSchema.safeParse({
      integration: 'slack',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.integration).toBe('slack')
    }
  })
})

describe('mcpServersSchema', () => {
  it('should validate a record of servers', () => {
    const result = mcpServersSchema.safeParse({
      myServer: { command: 'node', args: ['index.js'] },
      anotherServer: { type: 'http', url: 'http://localhost:3000' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data)).toHaveLength(2)
      expect(result.data.myServer.command).toBe('node')
    }
  })

  it('should validate an empty record', () => {
    const result = mcpServersSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data)).toHaveLength(0)
    }
  })

  it('should fail when value is not a valid config', () => {
    const result = mcpServersSchema.safeParse({
      badServer: 'not-an-object',
    })
    expect(result.success).toBe(false)
  })
})

describe('mcpSettingsSchema', () => {
  const validSettings = {
    toolCallTimeoutSeconds: 30,
    baseRestartDelayMs: 1000,
    maxRestartDelayMs: 60000,
    backoffMultiplier: 2,
  }

  it('should validate valid settings', () => {
    const result = mcpSettingsSchema.safeParse(validSettings)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.toolCallTimeoutSeconds).toBe(30)
      expect(result.data.backoffMultiplier).toBe(2)
    }
  })

  it('should fail when toolCallTimeoutSeconds is missing', () => {
    const { toolCallTimeoutSeconds: _, ...rest } = validSettings
    const result = mcpSettingsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when baseRestartDelayMs is missing', () => {
    const { baseRestartDelayMs: _, ...rest } = validSettings
    const result = mcpSettingsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when maxRestartDelayMs is missing', () => {
    const { maxRestartDelayMs: _, ...rest } = validSettings
    const result = mcpSettingsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when backoffMultiplier is missing', () => {
    const { backoffMultiplier: _, ...rest } = validSettings
    const result = mcpSettingsSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('should fail when values are strings instead of numbers', () => {
    const result = mcpSettingsSchema.safeParse({
      toolCallTimeoutSeconds: '30',
      baseRestartDelayMs: '1000',
      maxRestartDelayMs: '60000',
      backoffMultiplier: '2',
    })
    expect(result.success).toBe(false)
  })
})
