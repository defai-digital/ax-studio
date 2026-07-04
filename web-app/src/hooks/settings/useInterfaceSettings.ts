import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { useTheme } from '@/hooks/ui/useTheme'
import { createSafeJSONStorage } from '@/lib/storage/storage'

export type FontSize = '14px' | '15px' | '16px' | '18px' | '20px'

export const ACCENT_COLORS = [
  {
    name: 'Gray',
    value: 'gray',
    thumb: '#3F3F46',
    primary: '#6366f1',
    sidebar: { light: '#f1f1f1', dark: '#171717' },
  },
  {
    name: 'Red',
    value: 'red',
    thumb: '#F0614B',
    primary: '#F0614B',
    sidebar: { light: '#F3CBC4', dark: '#5E1308' },
  },
  {
    name: 'Orange',
    value: 'orange',
    thumb: '#E9A23F',
    primary: '#E9A23F',
    sidebar: { light: '#F3DFC4', dark: '#5C3A0A' },
  },
  {
    name: 'Green',
    value: 'green',
    thumb: '#88BA42',
    primary: '#88BA42',
    sidebar: { light: '#DFF3C4', dark: '#374B1B' },
  },
  {
    name: 'Emerald',
    value: 'emerald',
    thumb: '#38AB51',
    primary: '#38AB51',
    sidebar: { light: '#C4F3CE', dark: '#194D24' },
  },
  {
    name: 'Teal',
    value: 'teal',
    thumb: '#38AB8D',
    primary: '#38AB8D',
    sidebar: { light: '#C4F3E6', dark: '#194D3F' },
  },
  {
    name: 'Cyan',
    value: 'cyan',
    thumb: '#45BBDE',
    primary: '#45BBDE',
    sidebar: { light: '#C4E8F3', dark: '#0F4657' },
  },
  {
    name: 'Blue',
    value: 'blue',
    thumb: '#456BDE',
    primary: '#456BDE',
    sidebar: { light: '#C4D0F3', dark: '#0F2157' },
  },
  {
    name: 'Purple',
    value: 'purple',
    thumb: '#865EEA',
    primary: '#865EEA',
    sidebar: { light: '#D2C4F3', dark: '#220C5A' },
  },
  {
    name: 'Pink',
    value: 'pink',
    thumb: '#D55EF3',
    primary: '#D55EF3',
    sidebar: { light: '#FFDAE9', dark: '#4D075F' },
  },
  {
    name: 'Rose',
    value: 'rose',
    thumb: '#F655B8',
    primary: '#F655B8',
    sidebar: { light: '#F3C4E1', dark: '#61053E' },
  },
] as const

export type AccentColorValue = (typeof ACCENT_COLORS)[number]['value']
const DEFAULT_ACCENT_COLOR: AccentColorValue = 'gray'

// Pick black or white text for the best contrast on a given hex color,
// using WCAG relative luminance. Prevents unreadable white-on-light-accent
// text (e.g. Orange/Green) on primary surfaces.
const readableForeground = (hex: string): string => {
  const c = hex.replace('#', '')
  if (c.length < 6) return '#ffffff'
  const channel = (h: string) => {
    const v = parseInt(h, 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const L =
    0.2126 * channel(c.slice(0, 2)) +
    0.7152 * channel(c.slice(2, 4)) +
    0.0722 * channel(c.slice(4, 6))
  const contrastWhite = 1.05 / (L + 0.05)
  const contrastBlack = (L + 0.05) / 0.05
  return contrastWhite >= contrastBlack ? '#ffffff' : '#09090b'
}

export const applyAccentColorToDOM = (colorValue: string, isDark: boolean) => {
  const color = ACCENT_COLORS.find((c) => c.value === colorValue)
  if (!color) return

  const root = document.documentElement
  const onPrimary = readableForeground(color.primary)

  // Sidebar surface changes with theme
  root.style.setProperty(
    '--sidebar',
    isDark ? color.sidebar.dark : color.sidebar.light
  )

  // Primary surfaces + the tokens derived from primary. Setting only --primary
  // previously left focus rings, the sidebar active highlight, and primary-
  // foreground text stuck on the default indigo, breaking non-indigo accents.
  root.style.setProperty('--primary', color.primary)
  root.style.setProperty('--primary-foreground', onPrimary)
  root.style.setProperty('--ring', color.primary)
  root.style.setProperty('--sidebar-primary', color.primary)
  root.style.setProperty('--sidebar-primary-foreground', onPrimary)
  root.style.setProperty('--sidebar-ring', color.primary)
}

interface InterfaceSettingsState {
  fontSize: FontSize
  accentColor: AccentColorValue
  setFontSize: (size: FontSize) => void
  setAccentColor: (color: AccentColorValue) => void
  resetInterface: () => void
}

type InterfaceSettingsPersistedSlice = Omit<
  InterfaceSettingsState,
  'resetInterface' | 'setFontSize' | 'setAccentColor'
>

export const fontSizeOptions = [
  { label: 'Small', value: '14px' as FontSize },
  { label: 'Medium', value: '16px' as FontSize },
  { label: 'Large', value: '18px' as FontSize },
  { label: 'Extra Large', value: '20px' as FontSize },
]

// Default interface settings
const defaultFontSize: FontSize = '16px'

const createDefaultInterfaceValues = (): InterfaceSettingsPersistedSlice => {
  return {
    fontSize: defaultFontSize,
    accentColor: DEFAULT_ACCENT_COLOR,
  }
}

const interfaceStorage = createSafeJSONStorage<InterfaceSettingsState>(
  () => localStorage,
  'useInterfaceSettings'
)

export const useInterfaceSettings = create<InterfaceSettingsState>()(
  persist(
    (set) => {
      const defaultState = createDefaultInterfaceValues()
      return {
        ...defaultState,
        resetInterface: () => {
          const { isDark } = useTheme.getState()

          // Reset font size
          document.documentElement.style.setProperty(
            '--font-size-base',
            defaultFontSize
          )

          // Reset accent color preset
          applyAccentColorToDOM(DEFAULT_ACCENT_COLOR, isDark)

          // Update state
          set({
            fontSize: defaultFontSize,
            accentColor: DEFAULT_ACCENT_COLOR,
          })
        },

        setAccentColor: (color: AccentColorValue) => {
          const colorExists = ACCENT_COLORS.find((c) => c.value === color)
          if (!colorExists) return

          const { isDark } = useTheme.getState()
          applyAccentColorToDOM(color, isDark)
          set({ accentColor: color })
        },

        setFontSize: (size: FontSize) => {
          // Update CSS variable
          document.documentElement.style.setProperty('--font-size-base', size)
          // Update state
          set({ fontSize: size })
        },
      }
    },
    {
      name: localStorageKey.settingInterface,
      storage: interfaceStorage,
      // Apply settings when hydrating from storage
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migrate old font size value '15px' to '16px'
          if ((state.fontSize as FontSize) === '15px') {
            state.fontSize = '16px'
          }

          // Apply font size from storage
          document.documentElement.style.setProperty(
            '--font-size-base',
            state.fontSize
          )

          // Get the current theme state
          const { isDark } = useTheme.getState()

          // Apply accent color preset
          const accentColorValue = state.accentColor || DEFAULT_ACCENT_COLOR
          applyAccentColorToDOM(accentColorValue, isDark)
        }

        // Return the state to be used for hydration
        return state
      },
    }
  )
)

// Global subscription: applies accent color to DOM whenever theme changes.
// Intentionally module-scoped to survive for the app's lifetime.
let prevIsDark = useTheme.getState().isDark
useTheme.subscribe((state) => {
  if (state.isDark !== prevIsDark && typeof document !== 'undefined') {
    prevIsDark = state.isDark
    const { accentColor } = useInterfaceSettings.getState()
    applyAccentColorToDOM(accentColor, state.isDark)
  }
})
