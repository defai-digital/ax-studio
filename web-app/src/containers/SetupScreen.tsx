/**
 * AX Studio Setup / Onboarding Screen
 *
 * 6-step onboarding wizard shown on first launch.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Zap,
  Cpu,
  Shield,
  Wrench,
  MessageSquare,
  LockKeyhole,
  Database,
  Building2,
  Sun,
  Moon,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Sparkles,
  Check,
} from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { localStorageKey } from '@/constants/localStorage'
import { Button } from '@/components/ui/button'
import { safeStorageSetItem } from '@/lib/storage/storage'
import { useTheme } from '@/hooks/ui/useTheme'
import { useModelProvider } from '@/hooks/models/useModelProvider'
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

const TOTAL_STEPS = 6
const DEFAULT_WORKSPACE_MODE: WorkspaceModeId = 'developer-agent'

const workspaceModeDefs: {
  id: WorkspaceModeId
  icon: typeof MessageSquare
  labelKey: string
  descKey: string
}[] = [
  {
    id: 'simple-chat',
    icon: MessageSquare,
    labelKey: 'setup:modeSimpleChat',
    descKey: 'setup:modeSimpleChatDesc',
  },
  {
    id: 'local-private-ai',
    icon: LockKeyhole,
    labelKey: 'setup:modeLocalPrivate',
    descKey: 'setup:modeLocalPrivateDesc',
  },
  {
    id: 'developer-agent',
    icon: Wrench,
    labelKey: 'setup:modeDeveloperAgent',
    descKey: 'setup:modeDeveloperAgentDesc',
  },
  {
    id: 'knowledge-workspace',
    icon: Database,
    labelKey: 'setup:modeKnowledge',
    descKey: 'setup:modeKnowledgeDesc',
  },
  {
    id: 'controlled-workspace',
    icon: Building2,
    labelKey: 'setup:modeControlled',
    descKey: 'setup:modeControlledDesc',
  },
]

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1) // 1 = forward, -1 = backward
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceModeId>(
    DEFAULT_WORKSPACE_MODE
  )

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
      workspaceMode,
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
              {step === 1 && (
                <StepWorkspaceMode
                  selectedMode={workspaceMode}
                  onSelectMode={setWorkspaceMode}
                />
              )}
              {step === 2 && <StepTheme />}
              {step === 3 && <StepProviders />}
              {step === 4 && <StepPrivacy />}
              {step === 5 && <StepReady selectedMode={workspaceMode} />}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            <div>
              {step > 0 ? (
                <Button variant="ghost" size="sm" onClick={prev}>
                  <ChevronLeft className="size-4 mr-1" />
                  Back
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={skip}
                  className="text-muted-foreground"
                >
                  Skip
                </Button>
              )}
            </div>
            <div>
              {step < TOTAL_STEPS - 1 ? (
                <Button size="sm" onClick={next}>
                  Continue
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
      <p className="text-sm text-muted-foreground mb-6">
        {t('setup:getStartedDescription')}
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

/* ── Step 1: Workspace mode ───────────────────────── */

type StepWorkspaceModeProps = {
  selectedMode: WorkspaceModeId
  onSelectMode: (mode: WorkspaceModeId) => void
}

function StepWorkspaceMode({
  selectedMode,
  onSelectMode,
}: StepWorkspaceModeProps) {
  const { t } = useTranslation()

  return (
    <div className="text-center">
      <h2 className="text-xl font-bold mb-2">{t('setup:workspaceModeTitle')}</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {t('setup:workspaceModeDesc')}
      </p>
      <div className="space-y-2" role="listbox" aria-label={t('setup:workspaceModeTitle')}>
        {workspaceModeDefs.map((mode) => {
          const Icon = mode.icon
          const isActive = selectedMode === mode.id
          return (
            <button
              key={mode.id}
              type="button"
              role="option"
              aria-selected={isActive}
              aria-pressed={isActive}
              onClick={() => onSelectMode(mode.id)}
              className={`w-full flex items-center gap-3 rounded-xl border p-3 transition-all text-left ${
                isActive
                  ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/15'
                  : 'bg-card/50 hover:bg-card'
              }`}
            >
              <div
                className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t(mode.labelKey)}</span>
                  {mode.id === DEFAULT_WORKSPACE_MODE && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
                      {t('setup:recommended')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(mode.descKey)}
                </div>
              </div>
              {isActive && <Check className="size-4 text-primary shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Step 2: Theme ──────────────────────────────── */

function StepTheme() {
  const { activeTheme, setTheme } = useTheme()

  const themes: {
    id: 'light' | 'dark' | 'auto'
    icon: typeof Sun
    label: string
    desc: string
  }[] = [
    { id: 'light', icon: Sun, label: 'Light', desc: 'Clean and bright' },
    { id: 'dark', icon: Moon, label: 'Dark', desc: 'Easy on the eyes' },
    { id: 'auto', icon: Monitor, label: 'System', desc: 'Follows your OS' },
  ]

  return (
    <div className="text-center">
      <h2 className="text-xl font-bold mb-2">Choose your theme</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Pick an appearance that works for you. You can change this later.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {themes.map((theme) => {
          const Icon = theme.icon
          const isActive = activeTheme === theme.id
          return (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className={`rounded-xl border p-4 transition-all text-center ${
                isActive
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                  : 'bg-card/50 hover:bg-card hover:border-border/80'
              }`}
            >
              <Icon
                className={`size-6 mx-auto mb-2 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <div className="text-sm font-medium">{theme.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {theme.desc}
              </div>
              {isActive && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="mx-auto mt-2 size-5 rounded-full bg-primary flex items-center justify-center"
                >
                  <Check className="size-3 text-primary-foreground" />
                </motion.div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Step 3: Providers ──────────────────────────── */

function StepProviders() {
  const { providers, updateProvider } = useModelProvider()

  const knownProviders = [
    {
      name: 'llamacpp',
      label: 'Local (LlamaCPP)',
      desc: 'Run models on your hardware',
      recommended: true,
    },
    { name: 'openai', label: 'OpenAI', desc: 'GPT-4, GPT-3.5, and more' },
    { name: 'anthropic', label: 'Anthropic', desc: 'Claude models' },
    { name: 'groq', label: 'Groq', desc: 'Ultra-fast inference' },
    { name: 'google', label: 'Google Gemini', desc: 'Gemini models' },
  ]

  return (
    <div className="text-center">
      <h2 className="text-xl font-bold mb-2">Set up providers</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Enable the AI providers you want to use. You can add API keys later in
        Settings.
      </p>
      <div className="space-y-2">
        {knownProviders.map((kp) => {
          const provider = providers.find((p) => p.provider === kp.name)
          const isActive = provider?.active !== false

          return (
            <button
              key={kp.name}
              onClick={() => {
                if (provider) {
                  updateProvider(kp.name, { active: !isActive })
                }
              }}
              className={`w-full flex items-center gap-3 rounded-xl border p-3 transition-all text-left ${
                isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'bg-card/50 hover:bg-card'
              }`}
            >
              <div
                className={`size-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                  isActive
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/30'
                }`}
              >
                {isActive && (
                  <Check className="size-3 text-primary-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{kp.label}</span>
                  {kp.recommended && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{kp.desc}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Step 4: Privacy ──────────────────────────────── */

function StepPrivacy() {
  const privacyPoints = [
    {
      title: 'Local-first workspace',
      desc: 'Threads, settings, memory, and local models stay on your device',
    },
    {
      title: 'Connected services are explicit',
      desc: 'Cloud providers and remote tools receive data only when you use them',
    },
    {
      title: 'Your keys, your control',
      desc: 'Credentials are stored locally and used only with the service you configure',
    },
    {
      title: 'No AX Studio telemetry',
      desc: "We don't collect product analytics or conversation telemetry",
    },
  ]

  return (
    <div className="text-center">
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="mx-auto mb-5 size-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center"
      >
        <Shield className="size-7 text-emerald-500" />
      </motion.div>
      <h2 className="text-xl font-bold mb-2">Your privacy matters</h2>
      <p className="text-sm text-muted-foreground mb-6">
        AX Studio displays live AI-generated content. Review outputs before
        relying on them; you can report inappropriate content from Settings.
      </p>
      <div className="space-y-3">
        {privacyPoints.map((point) => (
          <div
            key={point.title}
            className="flex items-start gap-3 rounded-xl border bg-card/50 p-3 text-left"
          >
            <div className="shrink-0 mt-0.5 size-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="size-3 text-emerald-500" />
            </div>
            <div>
              <div className="text-sm font-medium">{point.title}</div>
              <div className="text-xs text-muted-foreground">{point.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Step 5: Ready ────────────────────────────────── */

function StepReady({ selectedMode }: { selectedMode: WorkspaceModeId }) {
  const { t } = useTranslation()
  const mode =
    workspaceModeDefs.find((m) => m.id === selectedMode) ??
    workspaceModeDefs.find((m) => m.id === DEFAULT_WORKSPACE_MODE) ??
    workspaceModeDefs[0]!
  const Icon = mode.icon
  const shortcuts = [
    { key: 'N', desc: t('common:newChat') },
    { key: 'K', desc: t('common:search') },
    { key: 'P', desc: t('settings:shortcuts.newProject') },
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
      <h2 className="text-xl font-bold mb-2">You&apos;re all set!</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Here are some keyboard shortcuts to get you started.
      </p>
      <div className="mb-4 flex items-start gap-3 rounded-xl border bg-card/50 p-3 text-left">
        <div className="shrink-0 mt-0.5 size-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="size-4 text-primary" />
        </div>
        <div>
          <div className="text-sm font-medium">{t(mode.labelKey)}</div>
          <div className="text-xs text-muted-foreground">{t(mode.descKey)}</div>
        </div>
      </div>
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
    </div>
  )
}
