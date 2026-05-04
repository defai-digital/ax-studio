import { createFileRoute } from '@tanstack/react-router'
import SettingsMenu from '@/components/common/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/components/common/Card'
import { useAttachments } from '@/hooks/chat/useAttachments'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Switch } from '@/components/ui/switch'
import { useShallow } from 'zustand/react/shallow'
import { FileText } from 'lucide-react'
import SettingsPageLayout from '@/components/settings/SettingsPageLayout'
import { useCallback, useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/settings/attachments')({
  component: AttachmentsSettings,
})

type SearchMode = 'auto' | 'ann' | 'linear'
type ParseMode = 'auto' | 'inline' | 'embeddings' | 'prompt'

function DebouncedInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  const [local, setLocal] = useState(String(value))
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    setLocal(String(value))
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      setLocal(raw)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const num = Number(raw)
        if (!Number.isFinite(num)) return
        const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, num))
        onChangeRef.current(clamped)
      }, 500)
    },
    [min, max]
  )

  return (
    <input
      type="number"
      value={local}
      onChange={handleChange}
      min={min}
      max={max}
      step={step ?? 1}
      className="w-24 h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

function SelectInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function AttachmentsSettings() {
  const { t } = useTranslation()

  const sel = useAttachments(
    useShallow((s) => ({
      enabled: s.enabled,
      maxFileSizeMB: s.maxFileSizeMB,
      retrievalLimit: s.retrievalLimit,
      retrievalThreshold: s.retrievalThreshold,
      chunkSizeChars: s.chunkSizeChars,
      overlapChars: s.overlapChars,
      searchMode: s.searchMode,
      parseMode: s.parseMode,
      autoInlineContextRatio: s.autoInlineContextRatio,
      setEnabled: s.setEnabled,
      setMaxFileSizeMB: s.setMaxFileSizeMB,
      setRetrievalLimit: s.setRetrievalLimit,
      setRetrievalThreshold: s.setRetrievalThreshold,
      setChunkSizeChars: s.setChunkSizeChars,
      setOverlapChars: s.setOverlapChars,
      setSearchMode: s.setSearchMode,
      setParseMode: s.setParseMode,
      setAutoInlineContextRatio: s.setAutoInlineContextRatio,
    }))
  )

  const parseModeOptions: { value: ParseMode; label: string }[] = [
    { value: 'auto', label: t('settings:attachments.parseModeAuto') },
    { value: 'inline', label: t('settings:attachments.parseModeInline') },
    { value: 'embeddings', label: t('settings:attachments.parseModeEmbeddings') },
    { value: 'prompt', label: t('settings:attachments.parseModePrompt') },
  ]

  const searchModeOptions: { value: SearchMode; label: string }[] = [
    { value: 'auto', label: t('settings:attachments.searchModeAuto') },
    { value: 'ann', label: t('settings:attachments.searchModeAnn') },
    { value: 'linear', label: t('settings:attachments.searchModeLinear') },
  ]

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <SettingsMenu />
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          <SettingsPageLayout icon={FileText} title={t('common:attachments') || 'Attachments'} />
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              <Card title={t('settings:attachments.featureTitle')}>
                <CardItem
                  title={t('settings:attachments.enable')}
                  description={t('settings:attachments.enableDesc')}
                  actions={
                    <Switch
                      checked={sel.enabled}
                      onCheckedChange={sel.setEnabled}
                    />
                  }
                />
                <CardItem
                  title={t('settings:attachments.parseMode')}
                  description={t('settings:attachments.parseModeDesc')}
                  actions={
                    <SelectInput
                      value={sel.parseMode}
                      options={parseModeOptions}
                      onChange={sel.setParseMode}
                    />
                  }
                />
                <CardItem
                  title={t('settings:attachments.autoInlineThreshold')}
                  description={t('settings:attachments.autoInlineThresholdDesc')}
                  actions={
                    <DebouncedInput
                      value={sel.autoInlineContextRatio}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={sel.setAutoInlineContextRatio}
                    />
                  }
                />
              </Card>

              <Card title={t('settings:attachments.limitsTitle')}>
                <CardItem
                  title={t('settings:attachments.maxFile')}
                  description={t('settings:attachments.maxFileDesc')}
                  actions={
                    <DebouncedInput
                      value={sel.maxFileSizeMB}
                      min={1}
                      max={1024}
                      step={1}
                      onChange={sel.setMaxFileSizeMB}
                    />
                  }
                />
              </Card>

              <Card title={t('settings:attachments.retrievalTitle')}>
                <CardItem
                  title={t('settings:attachments.topK')}
                  description={t('settings:attachments.topKDesc')}
                  actions={
                    <DebouncedInput
                      value={sel.retrievalLimit}
                      min={1}
                      max={100}
                      step={1}
                      onChange={sel.setRetrievalLimit}
                    />
                  }
                />
                <CardItem
                  title={t('settings:attachments.threshold')}
                  description={t('settings:attachments.thresholdDesc')}
                  actions={
                    <DebouncedInput
                      value={sel.retrievalThreshold}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={sel.setRetrievalThreshold}
                    />
                  }
                />
                <CardItem
                  title={t('settings:attachments.searchMode')}
                  description={t('settings:attachments.searchModeDesc')}
                  actions={
                    <SelectInput
                      value={sel.searchMode}
                      options={searchModeOptions}
                      onChange={sel.setSearchMode}
                    />
                  }
                />
              </Card>

              <Card title={t('settings:attachments.chunkingTitle')}>
                <CardItem
                  title={t('settings:attachments.chunkSize')}
                  description={t('settings:attachments.chunkSizeDesc')}
                  actions={
                    <DebouncedInput
                      value={sel.chunkSizeChars}
                      min={64}
                      max={8192}
                      step={64}
                      onChange={sel.setChunkSizeChars}
                    />
                  }
                />
                <CardItem
                  title={t('settings:attachments.chunkOverlap')}
                  description={t('settings:attachments.chunkOverlapDesc')}
                  actions={
                    <DebouncedInput
                      value={sel.overlapChars}
                      min={0}
                      max={2048}
                      step={16}
                      onChange={sel.setOverlapChars}
                    />
                  }
                />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
