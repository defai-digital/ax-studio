import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockIsToolDisabled = vi.fn().mockReturnValue(false)
const mockSetToolDisabledForThread = vi.fn()
const mockSetDefaultDisabledTools = vi.fn()
const mockGetDefaultDisabledTools = vi.fn().mockReturnValue([])

vi.mock('@/hooks/tools/useToolAvailable', () => ({
  useToolAvailable: () => ({
    isToolDisabled: mockIsToolDisabled,
    setToolDisabledForThread: mockSetToolDisabledForThread,
    setDefaultDisabledTools: mockSetDefaultDisabledTools,
    getDefaultDisabledTools: mockGetDefaultDisabledTools,
  }),
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: vi.fn((selector) =>
    selector({ getCurrentThread: () => ({ id: 'thread-42' }) })
  ),
}))

import { McpExtensionToolLoader } from '../McpExtensionToolLoader'

describe('McpExtensionToolLoader', () => {
  const tools = [
    { name: 'search', server: 'mcp-search', description: 'Search tool' },
    { name: 'calc', server: 'mcp-calc', description: 'Calculator' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when selectedModelHasTools is false', () => {
    const { container } = render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools={false}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when hasActiveMCPServers is false', () => {
    const { container } = render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers={false}
        selectedModelHasTools
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when MCPToolComponent is not provided', () => {
    const { container } = render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders MCPToolComponent when all conditions are met', () => {
    const MockComponent = vi.fn(({ tools: t }) => (
      <div data-testid="mcp-component">
        {t.map((tool: { name: string }) => (
          <span key={tool.name}>{tool.name}</span>
        ))}
      </div>
    ))

    render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
        MCPToolComponent={MockComponent}
      />
    )

    expect(screen.getByTestId('mcp-component')).toBeInTheDocument()
    expect(screen.getByText('search')).toBeInTheDocument()
    expect(screen.getByText('calc')).toBeInTheDocument()
  })

  it('passes isToolEnabled function that checks thread-specific state', () => {
    const MockComponent = vi.fn(({ isToolEnabled }) => (
      <div data-testid="mcp-component">
        <span data-testid="search-enabled">
          {isToolEnabled('search') ? 'yes' : 'no'}
        </span>
      </div>
    ))

    mockIsToolDisabled.mockReturnValue(false)

    render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
        MCPToolComponent={MockComponent}
      />
    )

    expect(screen.getByTestId('search-enabled').textContent).toBe('yes')
  })

  it('isToolEnabled returns false for unknown tool names', () => {
    const MockComponent = vi.fn(({ isToolEnabled }) => (
      <div data-testid="mcp-component">
        <span data-testid="unknown-enabled">
          {isToolEnabled('nonexistent') ? 'yes' : 'no'}
        </span>
      </div>
    ))

    render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
        MCPToolComponent={MockComponent}
      />
    )

    expect(screen.getByTestId('unknown-enabled').textContent).toBe('no')
  })

  it('uses default disabled tools when initialMessage is true', () => {
    mockGetDefaultDisabledTools.mockReturnValue(['mcp-search::search'])

    const MockComponent = vi.fn(({ isToolEnabled }) => (
      <div>
        <span data-testid="search-enabled">
          {isToolEnabled('search') ? 'yes' : 'no'}
        </span>
      </div>
    ))

    render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
        initialMessage
        MCPToolComponent={MockComponent}
      />
    )

    expect(screen.getByTestId('search-enabled').textContent).toBe('no')
  })

  it('onToolToggle calls setDefaultDisabledTools in initialMessage mode', () => {
    mockGetDefaultDisabledTools.mockReturnValue([])

    const MockComponent = vi.fn(({ onToolToggle }) => (
      <button
        data-testid="toggle-btn"
        onClick={() => onToolToggle('search', false)}
      />
    ))

    render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
        initialMessage
        MCPToolComponent={MockComponent}
      />
    )

    screen.getByTestId('toggle-btn').click()
    expect(mockSetDefaultDisabledTools).toHaveBeenCalledWith([
      'mcp-search::search',
    ])
  })

  it('onToolToggle calls setToolDisabledForThread in thread mode', () => {
    const MockComponent = vi.fn(({ onToolToggle }) => (
      <button
        data-testid="toggle-btn"
        onClick={() => onToolToggle('search', true)}
      />
    ))

    render(
      <McpExtensionToolLoader
        tools={tools}
        hasActiveMCPServers
        selectedModelHasTools
        MCPToolComponent={MockComponent}
      />
    )

    screen.getByTestId('toggle-btn').click()
    expect(mockSetToolDisabledForThread).toHaveBeenCalledWith(
      'thread-42',
      'mcp-search',
      'search',
      true
    )
  })
})
