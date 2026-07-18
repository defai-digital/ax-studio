import { describe, it, expect, beforeEach } from 'vitest'
import { useTemporaryChat } from '../useTemporaryChat'

describe('useTemporaryChat', () => {
  beforeEach(() => {
    useTemporaryChat.setState({ temporaryChatEnabled: false })
  })

  it('defaults to disabled', () => {
    expect(useTemporaryChat.getState().temporaryChatEnabled).toBe(false)
  })

  it('toggleTemporaryChat flips the flag', () => {
    useTemporaryChat.getState().toggleTemporaryChat()
    expect(useTemporaryChat.getState().temporaryChatEnabled).toBe(true)
    useTemporaryChat.getState().toggleTemporaryChat()
    expect(useTemporaryChat.getState().temporaryChatEnabled).toBe(false)
  })

  it('setTemporaryChatEnabled sets an explicit value', () => {
    useTemporaryChat.getState().setTemporaryChatEnabled(true)
    expect(useTemporaryChat.getState().temporaryChatEnabled).toBe(true)
    useTemporaryChat.getState().setTemporaryChatEnabled(false)
    expect(useTemporaryChat.getState().temporaryChatEnabled).toBe(false)
  })
})
