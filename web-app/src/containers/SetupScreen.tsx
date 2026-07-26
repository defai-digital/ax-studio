/**
 * AX Studio Setup / Onboarding Screen
 *
 * Short 2-step first-run: welcome → ready. Theme, providers, and workspace
 * mode use sensible defaults (change later in Settings).
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Zap,
  Cpu,
  Shield,
  Wrench,
  Keyboard,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { Button } from '@/components/ui/button'
import { safeStorageSetItem } from '@/lib/storage/storage'
import { HeaderPage } from './HeaderPage'

interface SetupScreenProps {
  onComplete?: () => void
}

type WorkspaceModeId =
  | 'simple-chat'
  | 'local-private-ai'
  | 'developer-agent'
  | 'knowledge-workspace'
  | 'controlled-workspace'

const TOTAL_STEPS = 2
const DEFAULT_WORKSPACE_MODE: WorkspaceModeId = 'developer-agent'

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1) // 1 = forward, -1 = backward

  const handleGetStarted = () => {
    safeStorageSetItem(
      localStorage,
      localStorageKey.setupCompleted,
      'true',
      'SetupScreen'
    )
    safeStorageSetItem(
      localStorage,
      localStorageKey.workspaceMode,
      DEFAULT_WORKSPACE_MODE,
      'SetupScreen'
    )
    onComplete?.()
  }

  const next = () => {
    setDirection(1)
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1))
  }

  const prev = () => {
    setDirection(-1)
    setStep((s) => Math.max(s - 1, 0))
  }

  const skip = () => {
    handleGetStarted()
  }

  return (
    <div className="flex h-full flex-col">
      <HeaderPage />
      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Progress indicator */}
          <div
            className="flex items-center justify-center gap-2 mb-8"
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={TOTAL_STEPS}
            aria-label={t('setup:stepOf', {
              current: step + 1,
              total: TOTAL_STEPS,
            })}
          >
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <motion.div
                key={i}
                className="rounded-full"
                aria-hidden="true"
                animate={{
                  width: i === step ? 24 : 8,
                  height: 8,
                  backgroundColor:
                    i === step
                      ? 'var(--primary)'
                      : i < step
                        ? 'var(--primary)'
                        : 'var(--muted)',
                  opacity: i <= step ? 1 : 0.4,
                }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            ))}
          </div>

          {/* Step content with slide animation */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              initial={{ x: direction * 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: direction * -60, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
            >
              {step === 0 && <StepWelcome />}
              {step === 1 && <StepReady />}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {step > 0 ? (
                <Button variant="ghost" size="sm" onClick={prev}>
                  <ChevronLeft className="size-4 mr-1" />
                  {t('common:back')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={skip}
                  className="text-muted-foreground"
                >
                  {t('common:skip')}
                </Button>
              )}
            </div>
            <div>
              {step < TOTAL_STEPS - 1 ? (
                <Button size="sm" onClick={next}>
                  {t('common:continue')}
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              ) : (
                <Button size="sm" onClick={handleGetStarted}>
                  {t('setup:getStarted')}
                  <Sparkles className="size-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Step 0: Welcome ──────────────────────────────── */

function StepWelcome() {
  const { t } = useTranslation()

  const features = [
    {
      icon: Cpu,
      titleKey: 'setup:featureLocalModels',
      descKey: 'setup:featureLocalModelsDesc',
    },
    {
      icon: Zap,
      titleKey: 'setup:featureLightningFast',
      descKey: 'setup:featureLightningFastDesc',
    },
    {
      icon: Shield,
      titleKey: 'setup:featurePrivateSecure',
      descKey: 'setup:featurePrivateSecureDesc',
    },
    {
      icon: Wrench,
      titleKey: 'setup:featureToolUse',
      descKey: 'setup:featureToolUseDesc',
    },
  ]

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="mx-auto mb-5 size-16 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-brand"
      >
        <Zap className="size-7 text-primary-foreground" strokeWidth={2} />
      </motion.div>
      <h2 className="text-xl font-bold mb-2">{t('setup:welcome')}</h2>
      <p className="text-sm text-muted-foreground mb-2">
        {t('setup:getStartedDescription')}
      </p>
      <p className="text-xs text-muted-foreground mb-6">
        {t('setup:privacyOneLiner')}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {features.map((f) => {
          const Icon = f.icon
          return (
            <div
              key={f.titleKey}
              className="rounded-xl border bg-card/50 p-3 text-left"
            >
              <Icon className="size-4 text-primary mb-2" />
              <div className="text-sm font-medium">{t(f.titleKey)}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t(f.descKey)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Step 1: Ready ────────────────────────────────── */

function StepReady() {
  const { t } = useTranslation()
  const shortcuts = [
    { key: 'N', desc: t('common:newChat') },
    { key: 'K', desc: t('common:search') },
    { key: 'B', desc: t('settings:shortcuts.toggleSidebar') },
  ]

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="mx-auto mb-5 size-14 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-brand"
      >
        <Sparkles className="size-7 text-primary-foreground" />
      </motion.div>
      <h2 className="text-xl font-bold mb-2">{t('setup:readyTitle')}</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {t('setup:readyDescription')}
      </p>
      <div className="rounded-xl border bg-card/50 overflow-hidden">
        {shortcuts.map((s, i) => (
          <div
            key={s.key}
            className={`flex items-center justify-between px-4 py-2.5 ${
              i < shortcuts.length - 1 ? 'border-b' : ''
            }`}
          >
            <span className="text-sm text-muted-foreground">{s.desc}</span>
            <div className="flex items-center gap-1">
              <Keyboard className="size-3 text-muted-foreground/50 mr-1" />
              <kbd className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                ⌘ {s.key}
              </kbd>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4">
        {t('setup:configureLater')}
      </p>
    </div>
  )
}
