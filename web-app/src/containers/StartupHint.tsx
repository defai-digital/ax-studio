import { Link } from '@tanstack/react-router'
import { Blocks, Cloud, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { localStorageKey } from '@/constants/localStorage'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  isStorageFlagEnabled,
  safeStorageSetItem,
} from '@/lib/storage/storage'

function wasPreviouslyDismissed(): boolean {
  return (
    isStorageFlagEnabled(
      localStorage,
      localStorageKey.startupHintDismissed,
      'StartupHint'
    ) ||
    // Respect completion of the retired onboarding wizard.
    isStorageFlagEnabled(
      localStorage,
      localStorageKey.setupCompleted,
      'StartupHint'
    )
  )
}

/**
 * A single, contextual first-run hint. It teaches the one prerequisite for
 * chat (choose a model) and links directly to both valid setup paths.
 */
export function StartupHint() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(() => !wasPreviouslyDismissed())

  if (!visible) return null

  const dismiss = () => {
    safeStorageSetItem(
      localStorage,
      localStorageKey.startupHintDismissed,
      'true',
      'StartupHint'
    )
    // Preserve compatibility with builds that used setup-completed.
    safeStorageSetItem(
      localStorage,
      localStorageKey.setupCompleted,
      'true',
      'StartupHint'
    )
    setVisible(false)
  }

  return (
    <section
      aria-labelledby="startup-hint-title"
      className="relative mb-4 rounded-xl border border-primary/15 bg-primary/[0.035] p-4 text-left shadow-sm"
    >
      <button
        type="button"
        aria-label={t('setup:dismissStartupHint')}
        className="absolute right-2.5 top-2.5 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={dismiss}
      >
        <X className="size-3.5" />
      </button>

      <div className="flex items-start gap-3 pr-7">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-primary-foreground shadow-brand">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 id="startup-hint-title" className="text-sm font-medium">
            {t('setup:startupHintTitle')}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('setup:startupHintDescription')}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 pl-11">
        <Link
          to={route.hub.index}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Blocks className="size-3.5" />
          {t('setup:browseLocalModels')}
        </Link>
        <Link
          to={route.settings.model_providers}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Cloud className="size-3.5" />
          {t('setup:connectCloudProvider')}
        </Link>
      </div>
    </section>
  )
}
