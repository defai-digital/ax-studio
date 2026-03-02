import { create } from 'zustand'

type WorkspaceChatsDialogState = {
  open: boolean
  setOpen: (value: boolean) => void
}

export const useWorkspaceChatsDialog = create<WorkspaceChatsDialogState>()((set) => ({
  open: false,
  setOpen: (value) => set({ open: value }),
}))
