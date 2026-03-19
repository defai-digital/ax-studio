import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavProjects } from '../NavProjects'

const mockAddFolder = vi.fn().mockResolvedValue({ id: 'new-project' })
const mockUpdateFolder = vi.fn()
const mockNavigate = vi.fn()
const mockSetCreateDialogOpen = vi.fn()

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:projects.title': 'Projects',
        'common:projects.new': 'New Project',
        'common:projects.viewProject': 'View Project',
        'common:projects.editProject': 'Edit Project',
        'common:projects.deleteProject': 'Delete Project',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: [
      { id: 'p1', name: 'My Project', logo: '' },
      { id: 'p2', name: 'Another Project', logo: 'https://example.com/logo.png' },
    ],
    addFolder: mockAddFolder,
    updateFolder: mockUpdateFolder,
  }),
}))

vi.mock('@/hooks/useProjectDialog', () => ({
  useProjectDialog: () => ({
    open: false,
    setOpen: mockSetCreateDialogOpen,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
  useNavigate: () => mockNavigate,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupAction: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuAction: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useSidebar: () => ({ isMobile: false }),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/containers/dialogs/AddProjectDialog', () => ({
  default: () => <div data-testid="add-project-dialog" />,
}))

vi.mock('@/containers/dialogs/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => <div data-testid="delete-project-dialog" />,
}))

describe('NavProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Projects heading', () => {
    render(<NavProjects />)
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('renders project items from folders', () => {
    render(<NavProjects />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
    expect(screen.getByText('Another Project')).toBeInTheDocument()
  })

  it('renders logo image when project has a logo URL', () => {
    render(<NavProjects />)
    const logos = screen.getAllByRole('img')
    expect(logos).toHaveLength(1)
    expect(logos[0]).toHaveAttribute('src', 'https://example.com/logo.png')
  })

  it('renders New Project action button', () => {
    render(<NavProjects />)
    expect(screen.getByTitle('New Project')).toBeInTheDocument()
  })
})
