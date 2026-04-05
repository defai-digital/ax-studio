import { Sun, Moon, Monitor } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTheme } from '@/hooks/ui/useTheme'
import { useState } from 'react'

type ThemeId = 'light' | 'dark' | 'auto'

const themeConfig: { id: ThemeId; icon: React.ReactNode; label: string }[] = [
  { id: 'light', icon: <Sun className="size-4" />, label: 'Light' },
  { id: 'dark', icon: <Moon className="size-4" />, label: 'Dark' },
  { id: 'auto', icon: <Monitor className="size-4" />, label: 'System' },
]

export function ThemeToggle() {
  const { activeTheme, setTheme } = useTheme()
  const [expanded, setExpanded] = useState(false)

  const currentConfig =
    themeConfig.find((t) => t.id === activeTheme) ?? themeConfig[2]

  const cycleTheme = () => {
    const order: ThemeId[] = ['light', 'dark', 'auto']
    const idx = order.indexOf(activeTheme)
    const next = order[(idx + 1) % order.length]
    setTheme(next)
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative flex items-center">
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden flex items-center mr-1"
            >
              <div className="flex items-center gap-0.5 bg-sidebar-accent rounded-lg p-0.5">
                {themeConfig.map((t) => (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          setTheme(t.id)
                          setExpanded(false)
                        }}
                        className={`p-1.5 rounded-md transition-all ${
                          activeTheme === t.id
                            ? 'bg-sidebar-primary/20 shadow-sm text-sidebar-foreground'
                            : 'text-sidebar-foreground/50 hover:text-sidebar-foreground'
                        }`}
                      >
                        {t.icon}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-[11px]">
                      {t.label}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={cycleTheme}
              onContextMenu={(e) => {
                e.preventDefault()
                setExpanded(!expanded)
              }}
              onDoubleClick={() => setExpanded(!expanded)}
              className="p-1 rounded-md hover:bg-sidebar-accent transition-colors text-sidebar-foreground/50 hover:text-sidebar-foreground relative"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTheme}
                  initial={{ scale: 0.5, opacity: 0, rotate: -90 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.5, opacity: 0, rotate: 90 }}
                  transition={{ duration: 0.2 }}
                >
                  {currentConfig.icon}
                </motion.div>
              </AnimatePresence>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[11px]">
            <span>{currentConfig.label} mode</span>
            <span className="block text-muted-foreground/60">
              Click to cycle · Double-click to expand
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
