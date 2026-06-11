import type { Variants, Transition } from 'motion/react'

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
