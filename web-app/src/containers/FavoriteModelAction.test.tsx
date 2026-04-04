import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FavoriteModelAction } from './FavoriteModelAction'

const mockToggleFavorite = vi.fn()
let mockIsFavoriteResult = false

vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: () => ({
    isFavorite: () => mockIsFavoriteResult,
    toggleFavorite: mockToggleFavorite,
  }),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@tabler/icons-react', () => ({
  IconStar: () => <span data-testid="icon-star" />,
  IconStarFilled: () => <span data-testid="icon-star-filled" />,
}))

const mockModel = {
  id: 'model-1',
  name: 'Test Model',
  provider: 'openai',
} as unknown as Model

describe('FavoriteModelAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFavoriteResult = false
  })

  it('renders unfilled star when model is not a favorite', () => {
    render(<FavoriteModelAction model={mockModel} />)
    expect(screen.getByTestId('icon-star')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-star-filled')).not.toBeInTheDocument()
  })

  it('renders filled star when model is a favorite', () => {
    mockIsFavoriteResult = true
    render(<FavoriteModelAction model={mockModel} />)
    expect(screen.getByTestId('icon-star-filled')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-star')).not.toBeInTheDocument()
  })

  it('calls toggleFavorite with the model on click', () => {
    render(<FavoriteModelAction model={mockModel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }))
    expect(mockToggleFavorite).toHaveBeenCalledWith(mockModel)
  })

  it('has accessible aria-label', () => {
    render(<FavoriteModelAction model={mockModel} />)
    expect(
      screen.getByRole('button', { name: 'Toggle favorite' })
    ).toBeInTheDocument()
  })
})
