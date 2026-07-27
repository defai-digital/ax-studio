import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGeneralSetting } from '../useGeneralSetting'

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    settingGeneral: 'general-settings',
  },
}))

describe('useGeneralSetting', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useGeneralSetting.setState({
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      globalDefaultPrompt: '',
      autoTuningEnabled: false,
      applyMode: 'all_chats',
    })
  })

  it('initializes with the general defaults and no credential fields', () => {
    const { result } = renderHook(() => useGeneralSetting())

    expect(result.current).toMatchObject({
      spellCheckChatInput: true,
      tokenCounterCompact: true,
      globalDefaultPrompt: '',
      autoTuningEnabled: false,
      applyMode: 'all_chats',
    })
    expect('huggingfaceToken' in result.current).toBe(false)
    expect('setHuggingfaceToken' in result.current).toBe(false)
  })

  it('updates general preferences across hook instances', () => {
    const { result: first } = renderHook(() => useGeneralSetting())
    const { result: second } = renderHook(() => useGeneralSetting())

    act(() => {
      first.current.setSpellCheckChatInput(false)
      first.current.setTokenCounterCompact(false)
      first.current.setGlobalDefaultPrompt('Be concise.')
      first.current.setAutoTuningEnabled(true)
      first.current.setApplyMode('new_chats_only')
    })

    expect(second.current).toMatchObject({
      spellCheckChatInput: false,
      tokenCounterCompact: false,
      globalDefaultPrompt: 'Be concise.',
      autoTuningEnabled: true,
      applyMode: 'new_chats_only',
    })
  })

  it('does not hydrate a legacy plaintext Hugging Face token', async () => {
    localStorage.setItem(
      'general-settings',
      JSON.stringify({
        state: {
          spellCheckChatInput: false,
          tokenCounterCompact: true,
          huggingfaceToken: 'hf_legacy_secret',
        },
        version: 0,
      })
    )

    await act(async () => {
      await useGeneralSetting.persist.rehydrate()
    })

    const state = useGeneralSetting.getState()
    expect(state.spellCheckChatInput).toBe(false)
    expect('huggingfaceToken' in state).toBe(false)
    // Leave the legacy payload available for the secure-storage migrator.
    expect(localStorage.getItem('general-settings')).toContain(
      'hf_legacy_secret'
    )
  })
})
