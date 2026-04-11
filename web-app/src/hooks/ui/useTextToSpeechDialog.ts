import { create } from 'zustand'

type TextToSpeechDialogState = {
  open: boolean
  setOpen: (value: boolean) => void
}

export const useTextToSpeechDialog = create<TextToSpeechDialogState>()((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}))
