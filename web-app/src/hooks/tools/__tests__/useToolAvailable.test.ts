import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useToolAvailable } from '../useToolAvailable'
import type { MCPTool } from '@/types/mcp'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    toolAvailability: 'tool-availability-settings',
  },
}))

describe('useToolAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Reset store state to defaults
    useToolAvailable.setState({
      disabledTools: {},
      defaultDisabledTools: [],
      defaultsInitialized: false,
    })
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useToolAvailable())

    expect(result.current.disabledTools).toEqual({})
    expect(result.current.defaultDisabledTools).toEqual([])
    expect(typeof result.current.setToolDisabledForThread).toBe('function')
    expect(typeof result.current.isToolDisabled).toBe('function')
    expect(typeof result.current.getDisabledToolsForThread).toBe('function')
    expect(typeof result.current.setDefaultDisabledTools).toBe('function')
    expect(typeof result.current.getDefaultDisabledTools).toBe('function')
    expect(typeof result.current.initializeThreadTools).toBe('function')
  })

  describe('setToolDisabledForThread', () => {
    it('should disable a tool for a thread', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
      })

      expect(result.current.disabledTools['thread-1']).toContain('server-1::tool-a')
    })

    it('should enable a tool for a thread', () => {
      const { result } = renderHook(() => useToolAvailable())

      // First disable the tool
      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
      })

      expect(result.current.disabledTools['thread-1']).toContain('server-1::tool-a')

      // Then enable the tool
      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', true)
      })

      expect(result.current.disabledTools['thread-1']).not.toContain('server-1::tool-a')
    })

    it('should handle multiple tools for same thread', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-b', false)
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-c', false)
      })

      expect(result.current.disabledTools['thread-1']).toEqual(['server-1::tool-a', 'server-1::tool-b', 'server-1::tool-c'])
    })

    it('should handle multiple threads independently', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
        result.current.setToolDisabledForThread('thread-2', 'server-1', 'tool-b', false)
        result.current.setToolDisabledForThread('thread-3', 'server-1', 'tool-c', false)
      })

      expect(result.current.disabledTools['thread-1']).toEqual(['server-1::tool-a'])
      expect(result.current.disabledTools['thread-2']).toEqual(['server-1::tool-b'])
      expect(result.current.disabledTools['thread-3']).toEqual(['server-1::tool-c'])
    })

    it('should not duplicate tools when disabling an already disabled tool', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
      })

      expect(result.current.disabledTools['thread-1']).toEqual(['server-1::tool-a'])
    })

    it('should handle enabling tool that was not disabled', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', true)
      })

      expect(result.current.disabledTools['thread-1']).toEqual([])
    })

    it('should ignore malformed runtime values', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('', 'server-1', 'tool-a', false)
        result.current.setToolDisabledForThread('thread-1', '', 'tool-a', false)
        result.current.setToolDisabledForThread(
          'thread-1',
          'server-1',
          'tool-a',
          'false' as never
        )
      })

      expect(result.current.disabledTools).toEqual({})
    })

    it('should trim runtime identifiers before storing', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread(
          ' thread-1 ',
          ' server-1 ',
          ' tool-a ',
          false
        )
      })

      expect(result.current.disabledTools).toEqual({
        'thread-1': ['server-1::tool-a'],
      })
    })
  })

  describe('isToolDisabled', () => {
    it('should return false for enabled tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      const isDisabled = result.current.isToolDisabled('thread-1', 'server-1', 'tool-a')
      expect(isDisabled).toBe(false)
    })

    it('should return true for disabled tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
      })

      const isDisabled = result.current.isToolDisabled('thread-1', 'server-1', 'tool-a')
      expect(isDisabled).toBe(true)
    })

    it('should use default disabled tools for new threads', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-default'])
      })

      const isDisabled = result.current.isToolDisabled('new-thread', 'server-1', 'tool-default')
      expect(isDisabled).toBe(true)
    })

    it('uses defaults for a prototype-named thread with no own override', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-default'])
      })

      expect(
        result.current.isToolDisabled(
          '__proto__',
          'server-1',
          'tool-default'
        )
      ).toBe(true)
      expect(result.current.getDisabledToolsForThread('__proto__')).toEqual([
        'server-1::tool-default',
      ])
    })

    it('should return false for tools not in default disabled list', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-default'])
      })

      const isDisabled = result.current.isToolDisabled('new-thread', 'server-1', 'tool-other')
      expect(isDisabled).toBe(false)
    })

    it('should prioritize thread-specific settings over defaults', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-default'])
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-default', true)
      })

      const isDisabled = result.current.isToolDisabled('thread-1', 'server-1', 'tool-default')
      expect(isDisabled).toBe(false)
    })

    it('should return false for malformed runtime ids', () => {
      const { result } = renderHook(() => useToolAvailable())

      expect(result.current.isToolDisabled('', 'server-1', 'tool-a')).toBe(false)
      expect(result.current.isToolDisabled('thread-1', '', 'tool-a')).toBe(false)
      expect(result.current.isToolDisabled({} as never, 'server-1', 'tool-a')).toBe(false)
    })

    it('should not throw when in-memory disabled tools are malformed', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        useToolAvailable.setState({
          disabledTools: { 'thread-1': 42 as never },
          defaultDisabledTools: ['server-1::tool-a'],
        })
      })

      expect(result.current.isToolDisabled('thread-1', 'server-1', 'tool-a')).toBe(false)
    })
  })

  describe('getDisabledToolsForThread', () => {
    it('should return empty array for thread with no disabled tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      const disabledTools = result.current.getDisabledToolsForThread('thread-1')
      expect(disabledTools).toEqual([])
    })

    it('should return disabled tools for thread', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-a', false)
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-b', false)
      })

      const disabledTools = result.current.getDisabledToolsForThread('thread-1')
      expect(disabledTools).toEqual(['server-1::tool-a', 'server-1::tool-b'])
    })

    it('should return default disabled tools for new threads', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-default-1', 'server-1::tool-default-2'])
      })

      const disabledTools = result.current.getDisabledToolsForThread('new-thread')
      expect(disabledTools).toEqual(['server-1::tool-default-1', 'server-1::tool-default-2'])
    })

    it('should return thread-specific tools even when defaults exist', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-default'])
        result.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-specific', false)
      })

      const disabledTools = result.current.getDisabledToolsForThread('thread-1')
      expect(disabledTools).toEqual(['server-1::tool-specific'])
    })

    it('should return an empty array for malformed runtime ids', () => {
      const { result } = renderHook(() => useToolAvailable())

      expect(result.current.getDisabledToolsForThread(null as never)).toEqual([])
    })
  })

  describe('setDefaultDisabledTools', () => {
    it('should set default disabled tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1', 'server-1::tool-2', 'server-1::tool-3'])
      })

      expect(result.current.defaultDisabledTools).toEqual(['server-1::tool-1', 'server-1::tool-2', 'server-1::tool-3'])
    })

    it('should replace existing default disabled tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1', 'server-1::tool-2'])
      })

      expect(result.current.defaultDisabledTools).toEqual(['server-1::tool-1', 'server-1::tool-2'])

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-3', 'server-1::tool-4'])
      })

      expect(result.current.defaultDisabledTools).toEqual(['server-1::tool-3', 'server-1::tool-4'])
    })

    it('should handle empty array', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1'])
      })

      expect(result.current.defaultDisabledTools).toEqual(['server-1::tool-1'])

      act(() => {
        result.current.setDefaultDisabledTools([])
      })

      expect(result.current.defaultDisabledTools).toEqual([])
    })

    it('should remove duplicate default disabled tools while preserving order', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools([
          'server-1::tool-1',
          'server-1::tool-1',
          'server-1::tool-2',
        ])
      })

      expect(result.current.defaultDisabledTools).toEqual([
        'server-1::tool-1',
        'server-1::tool-2',
      ])
    })

    it('should drop malformed default disabled tool keys', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools([
          'server-1::tool-1',
          '',
          'legacy-tool',
          '::missing-server',
          'server-2::tool-2',
        ] as never)
      })

      expect(result.current.defaultDisabledTools).toEqual([
        'server-1::tool-1',
        'server-2::tool-2',
      ])
    })
  })

  describe('getDefaultDisabledTools', () => {
    it('should return default disabled tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1', 'server-1::tool-2'])
      })

      const defaultTools = result.current.getDefaultDisabledTools()
      expect(defaultTools).toEqual(['server-1::tool-1', 'server-1::tool-2'])
    })

    it('should return empty array when no defaults set', () => {
      const { result } = renderHook(() => useToolAvailable())

      const defaultTools = result.current.getDefaultDisabledTools()
      expect(defaultTools).toEqual([])
    })
  })

  describe('initializeThreadTools', () => {
    it('should initialize thread with default tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      const allTools: MCPTool[] = [
        { name: 'tool-1', description: 'Tool 1', inputSchema: {}, server: 'server-1' },
        { name: 'tool-2', description: 'Tool 2', inputSchema: {}, server: 'server-1' },
        { name: 'tool-3', description: 'Tool 3', inputSchema: {}, server: 'server-1' },
      ]

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1', 'server-1::tool-3'])
        result.current.initializeThreadTools('new-thread', allTools)
      })

      expect(result.current.disabledTools['new-thread']).toEqual(['server-1::tool-1', 'server-1::tool-3'])
    })

    it('should not override existing thread settings', () => {
      const { result } = renderHook(() => useToolAvailable())

      const allTools: MCPTool[] = [
        { name: 'tool-1', description: 'Tool 1', inputSchema: {}, server: 'server-1' },
        { name: 'tool-2', description: 'Tool 2', inputSchema: {}, server: 'server-1' },
      ]

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1'])
        result.current.setToolDisabledForThread('existing-thread', 'server-1', 'tool-2', false)
        result.current.initializeThreadTools('existing-thread', allTools)
      })

      expect(result.current.disabledTools['existing-thread']).toEqual(['server-1::tool-2'])
    })

    it('should filter default tools to only include existing tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      const allTools: MCPTool[] = [
        { name: 'tool-1', description: 'Tool 1', inputSchema: {}, server: 'server-1' },
        { name: 'tool-2', description: 'Tool 2', inputSchema: {}, server: 'server-1' },
      ]

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1', 'server-1::tool-nonexistent', 'server-1::tool-2'])
        result.current.initializeThreadTools('new-thread', allTools)
      })

      expect(result.current.disabledTools['new-thread']).toEqual(['server-1::tool-1', 'server-1::tool-2'])
    })

    it('should handle empty default tools', () => {
      const { result } = renderHook(() => useToolAvailable())

      const allTools: MCPTool[] = [
        { name: 'tool-1', description: 'Tool 1', inputSchema: {}, server: 'server-1' },
      ]

      act(() => {
        result.current.setDefaultDisabledTools([])
        result.current.initializeThreadTools('new-thread', allTools)
      })

      expect(result.current.disabledTools['new-thread']).toEqual([])
    })

    it('should handle empty tools array', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1'])
        result.current.initializeThreadTools('new-thread', [])
      })

      expect(result.current.disabledTools['new-thread']).toEqual([])
    })

    it('should ignore malformed thread ids and tool lists', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1'])
        result.current.initializeThreadTools('', [] as MCPTool[])
        result.current.initializeThreadTools('new-thread', null as never)
      })

      expect(result.current.disabledTools).toEqual({})
    })

    it('should trim available tool identifiers before matching defaults', () => {
      const { result } = renderHook(() => useToolAvailable())

      act(() => {
        result.current.setDefaultDisabledTools(['server-1::tool-1'])
        result.current.initializeThreadTools('new-thread', [
          {
            name: ' tool-1 ',
            description: 'Tool 1',
            inputSchema: {},
            server: ' server-1 ',
          },
        ])
      })

      expect(result.current.disabledTools['new-thread']).toEqual([
        'server-1::tool-1',
      ])
    })
  })

  describe('state management', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useToolAvailable())
      const { result: result2 } = renderHook(() => useToolAvailable())

      act(() => {
        result1.current.setDefaultDisabledTools(['server-1::tool-default'])
        result1.current.setToolDisabledForThread('thread-1', 'server-1', 'tool-specific', false)
      })

      expect(result2.current.defaultDisabledTools).toEqual(['server-1::tool-default'])
      expect(result2.current.disabledTools['thread-1']).toEqual(['server-1::tool-specific'])
    })
  })

  describe('complex scenarios', () => {
    it('should handle complete tool management workflow', () => {
      const { result } = renderHook(() => useToolAvailable())

      const allTools: MCPTool[] = [
        { name: 'tool-a', description: 'Tool A', inputSchema: {}, server: 'test-server' },
        { name: 'tool-b', description: 'Tool B', inputSchema: {}, server: 'test-server' },
        { name: 'tool-c', description: 'Tool C', inputSchema: {}, server: 'test-server' },
      ]

      // Set default disabled tools (using composite keys)
      act(() => {
        result.current.setDefaultDisabledTools(['test-server::tool-a', 'test-server::tool-b'])
      })

      // Initialize thread with defaults
      act(() => {
        result.current.initializeThreadTools('thread-1', allTools)
      })

      expect(result.current.disabledTools['thread-1']).toEqual(['test-server::tool-a', 'test-server::tool-b'])

      // Enable tool-a for thread-1
      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'test-server', 'tool-a', true)
      })

      expect(result.current.disabledTools['thread-1']).toEqual(['test-server::tool-b'])

      // Disable tool-c for thread-1
      act(() => {
        result.current.setToolDisabledForThread('thread-1', 'test-server', 'tool-c', false)
      })

      expect(result.current.disabledTools['thread-1']).toEqual(['test-server::tool-b', 'test-server::tool-c'])

      // Verify tool states
      expect(result.current.isToolDisabled('thread-1', 'test-server', 'tool-a')).toBe(false)
      expect(result.current.isToolDisabled('thread-1', 'test-server', 'tool-b')).toBe(true)
      expect(result.current.isToolDisabled('thread-1', 'test-server', 'tool-c')).toBe(true)
    })
  })

  describe('persistence', () => {
    it('sanitizes malformed persisted state during merge and preserves actions', () => {
      const merge = useToolAvailable.persist.getOptions().merge
      const current = useToolAvailable.getState()

      const merged = merge?.(
        {
          disabledTools: {
            ' thread-1 ': [
              ' server-1 :: tool-a ',
              'server-1::tool-a',
              null,
              'server-1::',
              'server-2::tool-b',
            ],
            'thread-2': 42,
            'thread-3': ['::missing-server', 'server-3::tool-c'],
          },
          defaultDisabledTools: [
            ' server-4 :: tool-d ',
            'server-4::tool-d',
            'server-5::tool-e',
            'server-5::',
          ],
          defaultsInitialized: true,
          setDefaultDisabledTools: null,
        },
        current
      )

      expect(merged?.disabledTools).toEqual({
        'thread-1': ['server-1::tool-a', 'server-2::tool-b'],
        'thread-2': [],
        'thread-3': ['server-3::tool-c'],
      })
      expect(merged?.defaultDisabledTools).toEqual([
        'server-4::tool-d',
        'server-5::tool-e',
      ])
      expect(merged?.defaultsInitialized).toBe(true)
      expect(typeof merged?.setDefaultDisabledTools).toBe('function')
    })

    it('migrates legacy tool-key persisted state to empty defaults', () => {
      const migrate = useToolAvailable.persist.getOptions().migrate

      const migrated = migrate?.(
        {
          disabledTools: {
            'thread-1': ['legacy-tool', 'server-1::tool-a'],
          },
          defaultDisabledTools: ['server-2::tool-b'],
          defaultsInitialized: true,
        },
        0
      )

      expect(migrated).toEqual({
        disabledTools: {},
        defaultDisabledTools: [],
        defaultsInitialized: false,
      })
    })

    it('does not throw while migrating malformed persisted state', () => {
      const migrate = useToolAvailable.persist.getOptions().migrate

      expect(() =>
        migrate?.(
          {
            disabledTools: { 'thread-1': 42 },
            defaultDisabledTools: 'bad',
            defaultsInitialized: 'yes',
          },
          0
        )
      ).not.toThrow()

      expect(
        migrate?.(
          {
            disabledTools: { 'thread-1': 42 },
            defaultDisabledTools: 'bad',
            defaultsInitialized: 'yes',
          },
          0
        )
      ).toEqual({
        disabledTools: { 'thread-1': [] },
        defaultDisabledTools: [],
        defaultsInitialized: false,
      })
    })

    it('caps persisted disabled tool maps and lists', () => {
      const merge = useToolAvailable.persist.getOptions().merge
      const current = useToolAvailable.getState()
      const disabledTools = Object.fromEntries(
        Array.from({ length: 205 }, (_, threadIndex) => [
          `thread-${threadIndex}`,
          Array.from(
            { length: 205 },
            (_, toolIndex) => `server-${threadIndex}::tool-${toolIndex}`
          ),
        ])
      )

      const merged = merge?.(
        {
          disabledTools,
          defaultDisabledTools: Array.from(
            { length: 205 },
            (_, toolIndex) => `server-default::tool-${toolIndex}`
          ),
          defaultsInitialized: true,
        },
        current
      )

      expect(Object.keys(merged?.disabledTools ?? {})).toHaveLength(200)
      expect(merged?.disabledTools['thread-0']).toHaveLength(200)
      expect(merged?.defaultDisabledTools).toHaveLength(200)
    })
  })
})
