import { useAppState } from '@/hooks/settings/useAppState'
import { motion } from 'motion/react'
import { Zap } from 'lucide-react'

export function PromptProgress() {
  const promptProgress = useAppState((state) => state.promptProgress)

  const percentage =
    promptProgress && promptProgress.total > 0
      ? Math.round((promptProgress.processed / promptProgress.total) * 100)
      : 0

  // Show progress only when promptProgress exists and has valid data, and not completed
  if (
    !promptProgress ||
    !promptProgress.total ||
    promptProgress.total <= 0 ||
    percentage >= 100
  ) {
    return (
      <div className="flex gap-3 py-2">
        <div
          className="size-8 rounded-full flex items-center justify-center shrink-0 shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
        >
          <Zap className="size-4 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <div className="flex gap-1.5 items-center">
            {[0, 0.15, 0.3].map((delay, i) => (
              <motion.div
                key={i}
                animate={{ scale: [0.6, 1.1, 0.6], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.2, repeat: Infinity, delay }}
                className="size-2 rounded-full"
                style={{ backgroundColor: 'rgba(129, 140, 248, 0.6)' }}
              />
            ))}
          </div>
          <span className="text-[12px] text-muted-foreground/50">Thinking...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 py-2">
      <div
        className="size-8 rounded-full flex items-center justify-center shrink-0 shadow-sm"
        style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
      >
        <Zap className="size-4 text-white" strokeWidth={2.5} />
      </div>
      <div className="flex items-center gap-3 pt-1">
        <div className="flex gap-1.5 items-center">
          {[0, 0.15, 0.3].map((delay, i) => (
            <motion.div
              key={i}
              animate={{ scale: [0.6, 1.1, 0.6], opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay }}
              className="size-2 rounded-full"
              style={{ backgroundColor: 'rgba(129, 140, 248, 0.6)' }}
            />
          ))}
        </div>
        <span className="text-[12px] text-muted-foreground/60">Reading: {percentage}%</span>
      </div>
    </div>
  )
}
