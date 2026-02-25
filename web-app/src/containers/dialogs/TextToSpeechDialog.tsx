import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  getDefaultModelId,
  getDefaultSpeechProvider,
  getProviderHeaders,
  getSpeechProviders,
  getTextToAudioModels,
  normalizeBaseUrl,
} from '@/lib/speech-provider'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface TextToSpeechDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

export default function TextToSpeechDialog({
  open,
  onOpenChange,
}: TextToSpeechDialogProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const providers = useModelProvider((state) => state.providers)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)

  const [providerName, setProviderName] = useState('')
  const [modelId, setModelId] = useState('')
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('alloy')
  const [audioUrl, setAudioUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const speechProviders = useMemo(() => getSpeechProviders(providers), [providers])
  const activeProvider = useMemo(
    () => speechProviders.find((provider) => provider.provider === providerName),
    [speechProviders, providerName]
  )
  const ttsModels = useMemo(() => getTextToAudioModels(activeProvider), [activeProvider])

  useEffect(() => {
    if (!open) return
    const defaultProvider = getDefaultSpeechProvider(providers, selectedProvider)
    if (!defaultProvider) return
    setProviderName(defaultProvider.provider)
    setModelId(getDefaultModelId(defaultProvider, 'tts') || 'gpt-4o-mini-tts')
  }, [open, providers, selectedProvider])

  useEffect(() => {
    if (!activeProvider) return
    const defaultModel = getDefaultModelId(activeProvider, 'tts') || 'gpt-4o-mini-tts'
    if (!modelId || !activeProvider.models.some((model) => model.id === modelId)) {
      setModelId(defaultModel)
    }
  }, [activeProvider, modelId])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const handleSynthesize = async () => {
    if (!activeProvider?.base_url) {
      toast.error(t('speech.providerMissing'))
      return
    }
    if (!text.trim()) {
      toast.error(t('speech.textRequired'))
      return
    }

    setIsLoading(true)

    try {
      const endpoint = `${normalizeBaseUrl(activeProvider.base_url)}/audio/speech`
      const response = await serviceHub.providers().fetch()(endpoint, {
        method: 'POST',
        headers: getProviderHeaders(activeProvider, true),
        body: JSON.stringify({
          model: modelId || 'gpt-4o-mini-tts',
          input: text,
          voice: voice || 'alloy',
          response_format: 'mp3',
        }),
      })

      if (!response.ok) {
        const details = await response.text()
        throw new Error(details || `HTTP ${response.status}`)
      }

      const contentType = response.headers.get('content-type') || ''
      let audioBlob: Blob
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as Record<string, unknown>
        const base64 =
          (payload.audio as string) ||
          (payload.audio_base64 as string) ||
          (payload.data as string)
        if (!base64) {
          throw new Error('No audio data returned')
        }
        audioBlob = base64ToBlob(base64, 'audio/mpeg')
      } else {
        audioBlob = await response.blob()
      }

      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      const url = URL.createObjectURL(audioBlob)
      setAudioUrl(url)
      toast.success(t('speech.speechSuccess'))
    } catch (error) {
      console.error('Text-to-speech failed:', error)
      toast.error(t('speech.speechFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('speech.textToSpeechTitle')}</DialogTitle>
          <DialogDescription>{t('speech.textToSpeechDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('speech.provider')}</p>
              <select
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px]"
                value={providerName}
                onChange={(event) => setProviderName(event.target.value)}
              >
                {speechProviders.map((provider) => (
                  <option key={provider.provider} value={provider.provider}>
                    {provider.provider}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('speech.model')}</p>
              <Input
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                list="text-to-speech-model-list"
                placeholder="gpt-4o-mini-tts"
              />
              <datalist id="text-to-speech-model-list">
                {ttsModels.map((model) => (
                  <option key={model.id} value={model.id} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('speech.voice')}</p>
            <Input
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
              placeholder="alloy"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('speech.inputText')}</p>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-32"
              placeholder={t('speech.inputTextPlaceholder')}
            />
          </div>

          <Button onClick={handleSynthesize} disabled={isLoading || !text.trim()}>
            {isLoading ? t('speech.generatingSpeech') : t('speech.generateSpeech')}
          </Button>

          {audioUrl && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t('speech.generatedAudio')}</p>
              <audio controls className="w-full" src={audioUrl} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
