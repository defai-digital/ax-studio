import { beforeEach, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { useSearchHistory } from '../useSearchHistory'
function Search({ suggestions = false }: { suggestions?: boolean }) {
  const [value, setValue] = useState('draft')
  const history = useSearchHistory('test', value, setValue)
  return (
    <input
      aria-label="query"
      value={value}
      onChange={(e) => history.change(e.target.value)}
      onBlur={history.remember}
      onKeyDown={(e) => history.onKeyDown(e, !suggestions)}
    />
  )
}
beforeEach(() => localStorage.clear())
it('recalls searches and restores the draft without wrapping', () => {
  localStorage.setItem(
    'search-query-history:test',
    JSON.stringify(['new', 'old'])
  )
  render(<Search />)
  const input = screen.getByRole('textbox')
  for (const expected of ['new', 'old', 'old']) {
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input).toHaveValue(expected)
  }
  for (const expected of ['new', 'draft']) {
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveValue(expected)
  }
})
it('preserves edits as a new draft and persists only committed queries', () => {
  localStorage.setItem('search-query-history:test', '["old"]')
  render(<Search />)
  const input = screen.getByRole('textbox')
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  fireEvent.change(input, { target: { value: 'edited' } })
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  expect(input).toHaveValue('edited')
  fireEvent.blur(input)
  expect(
    JSON.parse(localStorage.getItem('search-query-history:test')!)
  ).toEqual(['edited', 'old'])
})
it('preserves suggestion keys and IME, with Alt+Up for explicit history recall', () => {
  localStorage.setItem('search-query-history:test', '["old"]')
  render(<Search suggestions />)
  const input = screen.getByRole('textbox')
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(input).toHaveValue('draft')
  fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true, isComposing: true })
  expect(input).toHaveValue('draft')
  fireEvent.keyDown(input, { key: 'ArrowUp', altKey: true })
  expect(input).toHaveValue('old')
})
it('ignores malformed saved history', () => {
  localStorage.setItem('search-query-history:test', '{"bad":true}')
  render(<Search />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp' })
  expect(screen.getByRole('textbox')).toHaveValue('draft')
})

it('bounds saved history and removes duplicates and invalid values', () => {
  localStorage.setItem(
    'search-query-history:test',
    JSON.stringify([
      null,
      '',
      'old',
      'old',
      ...Array.from({ length: 30 }, (_, i) => `query-${i}`),
    ])
  )
  render(<Search />)
  fireEvent.blur(screen.getByRole('textbox'))
  const saved = JSON.parse(localStorage.getItem('search-query-history:test')!)
  expect(saved).toHaveLength(20)
  expect(saved[0]).toBe('draft')
  expect(new Set(saved).size).toBe(20)
})
