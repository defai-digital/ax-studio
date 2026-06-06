import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useModelProvider } from '@/features/models/hooks/useModelProvider'
import {
  getChatCompletionsEndpoints,
  getDefaultModelId,
  getDefaultSpeechProvider,
  getProviderHeaders,
  getResponsesEndpoints,
  getSpeechEndpoints,
  getSpeechProviders,
  getTextToAudioModels,
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

const resolveAudioBase64 = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload as Record<string, unknown>

  // Direct fields: { audio, audio_base64, data }
  if (typeof data.audio === 'string') return data.audio
  if (typeof data.audio_base64 === 'string') return data.audio_base64
  if (typeof data.data === 'string') return data.data

  // Responses API: output[].content[].audio or output[].content[].data
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (!item || typeof item !== 'object') continue
      const content = (item as Record<string, unknown>).content
      if (!Array.isArray(content)) continue
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const p = part as Record<string, unknown>
        if (typeof p.audio === 'string') return p.audio
        if (typeof p.data === 'string') return p.data
      }
    }
  }

  // Chat Completions API: choices[].message.audio.data
  if (Array.isArray(data.choices)) {
    for (const choice of data.choices) {
      if (!choice || typeof choice !== 'object') continue
      const message = (choice as Record<string, unknown>).message
      if (!message || typeof message !== 'object') continue
      const audio = (message as Record<string, unknown>).audio
      if (!audio || typeof audio !== 'object') continue
      const audioData = (audio as Record<string, unknown>).data
      if (typeof audioData === 'string') return audioData
    }
  }

  return ''
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
  const [errorDetails, setErrorDetails] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const speechProviders = useMemo(() => getSpeechProviders(providers), [providers])
  const activeProvider = useMemo(
    () => speechProviders.find((provider) => provider.provider === providerName),
    [speechProviders, providerName]
  )
  const ttsModels = useMemo(() => getTextToAudioModels(activeProvider), [activeProvider])

  const clearInFlightRequest = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
  }, [])

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
    if (!open) {
      clearInFlightRequest()
      setIsLoading(false)
      setErrorDetails('')
      return
    }
    setIsLoading(false)
    setErrorDetails('')
  }, [clearInFlightRequest, open])

  useEffect(() => {
    return () => {
      clearInFlightRequest()
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [clearInFlightRequest, audioUrl])

  const handleSynthesize = async () => {
    if (!activeProvider?.base_url) {
      setErrorDetails(t('speech.providerMissing'))
      toast.error(t('speech.providerMissing'))
      return
    }
    if (!text.trim()) {
      setErrorDetails(t('speech.textRequired'))
      toast.error(t('speech.textRequired'))
      return
    }

    setIsLoading(true)
    setErrorDetails('')

    try {
      clearInFlightRequest()
      const controller = new AbortController()
      abortRef.current = controller
      timeoutRef.current = setTimeout(() => {
        controller.abort()
      }, 60_000)

      const model = modelId || 'gpt-4o-mini-tts'
      const selectedVoice = voice || 'alloy'
      let lastError = ''

      // ── Tier 1: /audio/speech endpoints ──
      const speechEndpoints = getSpeechEndpoints(activeProvider.base_url)
      for (const endpoint of speechEndpoints) {
        const response = await serviceHub.providers().fetch()(endpoint, {
          method: 'POST',
          headers: getProviderHeaders(activeProvider, true),
          body: JSON.stringify({
            model,
            input: text,
            voice: selectedVoice,
            response_format: 'mp3',
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const details = (await response.text()).trim()
          const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
          lastError = `HTTP ${response.status}${detailsText}`
          continue
        }

        const contentType = response.headers.get('content-type') || ''
        let audioBlob: Blob
        if (contentType.includes('application/json')) {
          const payload = (await response.json()) as Record<string, unknown>
          const base64 = resolveAudioBase64(payload)
          if (!base64) {
            lastError = 'No audio data returned'
            continue
          }
          audioBlob = base64ToBlob(base64, 'audio/mpeg')
        } else {
          audioBlob = await response.blob()
        }

        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(audioBlob))
        setErrorDetails('')
        toast.success(t('speech.speechSuccess'))
        return
      }

      // ── Tier 2: /responses endpoints (OpenAI Responses API) ──
      const responsesEndpoints = getResponsesEndpoints(activeProvider.base_url)
      for (const endpoint of responsesEndpoints) {
        const response = await serviceHub.providers().fetch()(endpoint, {
          method: 'POST',
          headers: getProviderHeaders(activeProvider, true),
          body: JSON.stringify({
            model,
            input: text,
            voice: selectedVoice,
            modalities: ['audio'],
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const details = (await response.text()).trim()
          const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
          lastError = `HTTP ${response.status}${detailsText}`
          continue
        }

        const payload = (await response.json()) as Record<string, unknown>
        const base64 = resolveAudioBase64(payload)
        if (!base64) {
          lastError = 'No audio data returned'
          continue
        }

        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(base64ToBlob(base64, 'audio/mpeg')))
        setErrorDetails('')
        toast.success(t('speech.speechSuccess'))
        return
      }

      // ── Tier 3: /chat/completions endpoints (Chat API with audio) ──
      const chatEndpoints = getChatCompletionsEndpoints(activeProvider.base_url)
      for (const endpoint of chatEndpoints) {
        const response = await serviceHub.providers().fetch()(endpoint, {
          method: 'POST',
          headers: getProviderHeaders(activeProvider, true),
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: text }],
            modalities: ['audio'],
            audio: { voice: selectedVoice, format: 'mp3' },
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const details = (await response.text()).trim()
          const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
          lastError = `HTTP ${response.status}${detailsText}`
          continue
        }

        const payload = (await response.json()) as Record<string, unknown>
        const base64 = resolveAudioBase64(payload)
        if (!base64) {
          lastError = 'No audio data returned'
          continue
        }

        if (audioUrl) URL.revokeObjectURL(audioUrl)
        setAudioUrl(URL.createObjectURL(base64ToBlob(base64, 'audio/mpeg')))
        setErrorDetails('')
        toast.success(t('speech.speechSuccess'))
        return
      }

      throw new Error(lastError || t('speech.speechFailed'))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setErrorDetails(t('speech.speechTimeout'))
        toast.error(t('speech.speechTimeout'))
        return
      }
      console.error('Text-to-speech failed:', error)
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('speech.speechFailed')
      setErrorDetails(message)
      toast.error(`${t('speech.speechFailed')}: ${message}`)
    } finally {
      clearInFlightRequest()
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
          {errorDetails && (
            <p className="text-xs text-destructive break-words">{errorDetails}</p>
          )}

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
