import { create } from 'zustand'

type SpeechToTextDialogState = {
  open: boolean
  setOpen: (value: boolean) => void
}

export const useSpeechToTextDialog = create<SpeechToTextDialogState>()((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}))
