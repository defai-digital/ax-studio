import type { Variants, Transition } from 'motion/react'

// --- Shared transitions ---
export const springTransition: Transition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
}

export const smoothTransition: Transition = {
  duration: 0.3,
  ease: [0.4, 0, 0.2, 1],
}

// --- Page / route transitions ---
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export const pageTransition: Transition = {
  duration: 0.25,
  ease: [0.4, 0, 0.2, 1],
}

// --- Message item enter ---
export const messageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
}

export const messageTransition: Transition = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1],
}

// --- Sidebar item ---
export const sidebarItemVariants: Variants = {
  initial: { opacity: 0, x: -12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
}

// --- Fade in/out ---
export const fadeVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

// --- Scale pop (for tooltips, popovers) ---
export const scaleVariants: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
}

// --- Slide up (for modals, dialogs) ---
export const slideUpVariants: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 16 },
}

// --- Collapse / expand (for accordion-style) ---
export const collapseVariants: Variants = {
  collapsed: { height: 0, opacity: 0, overflow: 'hidden' },
  expanded: { height: 'auto', opacity: 1, overflow: 'hidden' },
}

// --- Stagger children helper ---
export const staggerContainer: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

// --- Onboarding step slide ---
export const onboardingStepVariants = (direction: number): Variants => ({
  initial: { opacity: 0, x: direction > 0 ? 100 : -100 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: direction > 0 ? -100 : 100 },
})
