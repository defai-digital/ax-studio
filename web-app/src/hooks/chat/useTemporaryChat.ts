import { create } from 'zustand'

/**
 * useTemporaryChat — global on/off state for Temporary Chat mode.
 *
 * When enabled, sending from the new-chat composer routes to the in-memory
 * `temporary-chat` thread (see use-chat-send-handler) instead of creating a
 * persisted thread. Session-only by design: the flag is intentionally not
 * persisted, so a fresh app start always begins in normal mode.
 */
type TemporaryChatState = {
  temporaryChatEnabled: boolean
  setTemporaryChatEnabled: (value: boolean) => void
  toggleTemporaryChat: () => void
}

export const useTemporaryChat = create<TemporaryChatState>((set) => ({
  temporaryChatEnabled: false,
  setTemporaryChatEnabled: (value) => set({ temporaryChatEnabled: value }),
  toggleTemporaryChat: () =>
    set((state) => ({ temporaryChatEnabled: !state.temporaryChatEnabled })),
}))
