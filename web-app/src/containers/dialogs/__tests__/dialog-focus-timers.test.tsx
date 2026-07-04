import type { ReactNode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RenameThreadDialog } from '../thread/RenameThreadDialog'

const mocks = vi.hoisted(() => ({
  dialogOnOpenChange: undefined as ((open: boolean) => void) | undefined,
  onRename: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => {
    mocks.dialogOnOpenChange = onOpenChange
    return (
      <div>
        <button type="button" onClick={() => onOpenChange?.(false)}>
          Close dialog
        </button>
        {children}
      </div>
    )
  },
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button" onClick={() => mocks.dialogOnOpenChange?.(true)}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('lucide-react', () => ({
  Pencil: () => <span data-testid="pencil-icon" />,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}))

describe('dialog delayed focus timers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('clears pending rename focus when the dialog closes', () => {
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select')
    const thread = {
      id: 'thread-1',
      title: 'Existing title',
      created: Date.now(),
      updated: Date.now(),
      messages: [],
    } as unknown as Thread

    const { rerender } = render(
      <RenameThreadDialog
        thread={thread}
        plainTitleForRename="Existing title"
        onRename={mocks.onRename}
        open
        onOpenChange={vi.fn()}
        withoutTrigger
      />
    )

    rerender(
      <RenameThreadDialog
        thread={thread}
        plainTitleForRename="Existing title"
        onRename={mocks.onRename}
        open={false}
        onOpenChange={vi.fn()}
        withoutTrigger
      />
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(focusSpy).not.toHaveBeenCalled()
    expect(selectSpy).not.toHaveBeenCalled()
  })
})
