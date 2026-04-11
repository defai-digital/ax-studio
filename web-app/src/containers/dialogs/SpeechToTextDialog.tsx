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
import { useModelProvider } from '@/hooks/models/useModelProvider'
import {
  getChatCompletionsEndpoints,
  getAudioToTextModels,
  getDefaultModelId,
  getDefaultSpeechProvider,
  getProviderHeaders,
  getResponsesEndpoints,
  getSpeechProviders,
  getTranscriptionEndpoints,
} from '@/lib/speech-provider'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface SpeechToTextDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const resolveTranscript = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload as Record<string, unknown>
  if (typeof data.text === 'string') return data.text
  if (typeof data.transcript === 'string') return data.transcript
  if (typeof data.output_text === 'string') return data.output_text
  if (Array.isArray(data.segments)) {
    return data.segments
      .map((segment) =>
        typeof segment === 'object' && segment
          ? String((segment as Record<string, unknown>).text || '')
          : ''
      )
      .join(' ')
      .trim()
  }
  if (Array.isArray(data.output)) {
    const texts = data.output
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const content = (item as Record<string, unknown>).content
        if (!Array.isArray(content)) return []
        return content
      })
      .map((contentPart) => {
        if (!contentPart || typeof contentPart !== 'object') return ''
        return String(
          (contentPart as Record<string, unknown>).text ??
            (contentPart as Record<string, unknown>).transcript ??
            ''
        )
      })
      .filter(Boolean)
    if (texts.length > 0) return texts.join(' ').trim()
  }
  if (Array.isArray(data.choices)) {
    const choiceTexts = data.choices
      .flatMap((choice) => {
        if (!choice || typeof choice !== 'object') return []
        const message = (choice as Record<string, unknown>).message
        if (!message || typeof message !== 'object') return []
        const content = (message as Record<string, unknown>).content
        if (typeof content === 'string') return [content]
        if (!Array.isArray(content)) return []
        return content
          .map((part) => {
            if (!part || typeof part !== 'object') return ''
            return String((part as Record<string, unknown>).text ?? '')
          })
          .filter(Boolean)
      })
      .filter(Boolean)
    if (choiceTexts.length > 0) return choiceTexts.join(' ').trim()
  }
  return ''
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result || '')
      const base64 = value.includes(',') ? value.split(',')[1] : value
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio file'))
    reader.readAsDataURL(file)
  })

const detectAudioFormat = (file: File): string => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension) return extension
  const mime = file.type.toLowerCase()
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'mp3'
}

const isLikelyNonTranscript = (text: string): boolean => {
  const normalized = text.toLowerCase()
  return (
    normalized.includes('provide me with the audio') ||
    normalized.includes('need the actual audio') ||
    normalized.includes('give me the audio') ||
    normalized.includes('link to it in order to transcribe')
  )
}

export default function SpeechToTextDialog({
  open,
  onOpenChange,
}: SpeechToTextDialogProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const providers = useModelProvider((state) => state.providers)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)

  const [providerName, setProviderName] = useState('')
  const [modelId, setModelId] = useState('')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcript, setTranscript] = useState('')
  const [errorDetails, setErrorDetails] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const speechProviders = useMemo(() => getSpeechProviders(providers), [providers])
  const activeProvider = useMemo(
    () => speechProviders.find((provider) => provider.provider === providerName),
    [speechProviders, providerName]
  )
  const sttModels = useMemo(() => getAudioToTextModels(activeProvider), [activeProvider])

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
    setModelId(getDefaultModelId(defaultProvider, 'stt') || 'whisper-1')
  }, [open, providers, selectedProvider])

  useEffect(() => {
    if (!activeProvider) return
    const defaultModel = getDefaultModelId(activeProvider, 'stt') || 'whisper-1'
    if (!modelId || !activeProvider.models.some((model) => model.id === modelId)) {
      setModelId(defaultModel)
    }
  }, [activeProvider, modelId])

  useEffect(() => {
    if (!open) {
      clearInFlightRequest()
      setIsLoading(false)
      setAudioFile(null)
      setErrorDetails('')
      return
    }
    setIsLoading(false)
    setErrorDetails('')
  }, [clearInFlightRequest, open])

  useEffect(() => {
    return () => {
      clearInFlightRequest()
    }
  }, [clearInFlightRequest])

  const handleTranscribe = async () => {
    if (!activeProvider?.base_url) {
      setErrorDetails(t('speech.providerMissing'))
      toast.error(t('speech.providerMissing'))
      return
    }
    if (!audioFile) {
      setErrorDetails(t('speech.audioFileRequired'))
      toast.error(t('speech.audioFileRequired'))
      return
    }

    setIsLoading(true)
    setTranscript('')
    setErrorDetails('')

    try {
      clearInFlightRequest()
      const controller = new AbortController()
      abortRef.current = controller
      timeoutRef.current = setTimeout(() => {
        controller.abort()
      }, 60_000)

      const endpoints = getTranscriptionEndpoints(activeProvider.base_url)
      if (endpoints.length === 0) {
        throw new Error(t('speech.providerMissing'))
      }

      let lastError = ''
      let needsJsonFallback = false
      for (const endpoint of endpoints) {
        const formData = new FormData()
        formData.append('file', audioFile, audioFile.name)
        formData.append('model', modelId || 'whisper-1')

        const response = await serviceHub.providers().fetch()(endpoint, {
          method: 'POST',
          headers: getProviderHeaders(activeProvider),
          body: formData,
          signal: controller.signal,
        })

        if (!response.ok) {
          const details = (await response.text()).trim()
          if (
            response.status === 415 &&
            /application\/json/i.test(details)
          ) {
            needsJsonFallback = true
          }
          const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
          lastError = `HTTP ${response.status}${detailsText}`
          continue
        }

        const payload = await response.json()
        const resultText = resolveTranscript(payload)
        if (!resultText || isLikelyNonTranscript(resultText)) {
          lastError = t('speech.noTranscriptReturned')
          continue
        }

        setTranscript(resultText)
        setErrorDetails('')
        toast.success(t('speech.transcriptionSuccess'))
        return
      }

      if (needsJsonFallback) {
        const responsesEndpoints = getResponsesEndpoints(activeProvider.base_url)
        const audioBase64 = await fileToBase64(audioFile)
        const format = detectAudioFormat(audioFile)
        const transcriptionJsonPayloads: Record<string, unknown>[] = [
          {
            model: modelId || 'whisper-1',
            input_audio: {
              data: audioBase64,
              format,
            },
          },
          {
            model: modelId || 'whisper-1',
            file: {
              data: audioBase64,
              format,
            },
          },
          {
            model: modelId || 'whisper-1',
            audio: audioBase64,
            format,
          },
          {
            model: modelId || 'whisper-1',
            input: `data:audio/${format};base64,${audioBase64}`,
          },
        ]

        for (const endpoint of endpoints) {
          for (const payload of transcriptionJsonPayloads) {
            const response = await serviceHub.providers().fetch()(endpoint, {
              method: 'POST',
              headers: getProviderHeaders(activeProvider, true),
              body: JSON.stringify(payload),
              signal: controller.signal,
            })

            if (!response.ok) {
              const details = (await response.text()).trim()
              const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
              lastError = `HTTP ${response.status}${detailsText}`
              continue
            }

              const jsonPayload = await response.json()
              const resultText = resolveTranscript(jsonPayload)
              if (!resultText || isLikelyNonTranscript(resultText)) {
                lastError = t('speech.noTranscriptReturned')
                continue
              }

            setTranscript(resultText)
            setErrorDetails('')
            toast.success(t('speech.transcriptionSuccess'))
            return
          }
        }

        const responsesPayloads: Record<string, unknown>[] = [
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Transcribe this audio exactly as spoken.' },
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: audioBase64,
                      format,
                    },
                  },
                ],
              },
            ],
          },
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            input: [
              { type: 'input_text', text: 'Transcribe this audio exactly as spoken.' },
              {
                type: 'input_audio',
                input_audio: {
                  data: audioBase64,
                  format,
                },
              },
            ],
          },
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            input: 'Transcribe this audio exactly as spoken.',
            input_audio: {
              data: audioBase64,
              format,
            },
          },
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            input: `data:audio/${format};base64,${audioBase64}`,
          },
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Transcribe this audio exactly as spoken.' },
                  {
                    type: 'input_audio',
                    audio_url: `data:audio/${format};base64,${audioBase64}`,
                  },
                ],
              },
            ],
          },
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            input: [
              {
                role: 'user',
                content: [
                  { type: 'input_text', text: 'Transcribe this audio exactly as spoken.' },
                  {
                    type: 'input_audio',
                    input_audio: `data:audio/${format};base64,${audioBase64}`,
                  },
                ],
              },
            ],
          },
        ]

        for (const endpoint of responsesEndpoints) {
          for (const payload of responsesPayloads) {
            const response = await serviceHub.providers().fetch()(endpoint, {
              method: 'POST',
              headers: getProviderHeaders(activeProvider, true),
              body: JSON.stringify(payload),
              signal: controller.signal,
            })

            if (!response.ok) {
              const details = (await response.text()).trim()
              const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
              lastError = `HTTP ${response.status}${detailsText}`
              continue
            }

              const jsonPayload = await response.json()
              const resultText = resolveTranscript(jsonPayload)
              if (!resultText || isLikelyNonTranscript(resultText)) {
                lastError = t('speech.noTranscriptReturned')
                continue
              }

            setTranscript(resultText)
            setErrorDetails('')
            toast.success(t('speech.transcriptionSuccess'))
            return
          }
        }

        const chatCompletionsEndpoints = getChatCompletionsEndpoints(activeProvider.base_url)
        const chatPayloads: Record<string, unknown>[] = [
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Transcribe this audio exactly as spoken.' },
                  {
                    type: 'input_audio',
                    input_audio: {
                      data: audioBase64,
                      format,
                    },
                  },
                ],
              },
            ],
          },
          {
            model: modelId || 'gpt-4o-mini-transcribe',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Transcribe this audio exactly as spoken.' },
                  {
                    type: 'audio_url',
                    audio_url: {
                      url: `data:audio/${format};base64,${audioBase64}`,
                    },
                  },
                ],
              },
            ],
          },
        ]

        for (const endpoint of chatCompletionsEndpoints) {
          for (const payload of chatPayloads) {
            const response = await serviceHub.providers().fetch()(endpoint, {
              method: 'POST',
              headers: getProviderHeaders(activeProvider, true),
              body: JSON.stringify(payload),
              signal: controller.signal,
            })

            if (!response.ok) {
              const details = (await response.text()).trim()
              const detailsText = details ? ` - ${details.slice(0, 220)}` : ''
              lastError = `HTTP ${response.status}${detailsText}`
              continue
            }

            const jsonPayload = await response.json()
            const resultText = resolveTranscript(jsonPayload)
            if (!resultText || isLikelyNonTranscript(resultText)) {
              lastError = t('speech.noTranscriptReturned')
              continue
            }

            setTranscript(resultText)
            setErrorDetails('')
            toast.success(t('speech.transcriptionSuccess'))
            return
          }
        }
      }

      throw new Error(lastError || t('speech.transcriptionFailed'))
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setErrorDetails(t('speech.transcriptionTimeout'))
        toast.error(t('speech.transcriptionTimeout'))
        return
      }
      console.error('Speech-to-text failed:', error)
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('speech.transcriptionFailed')
      setErrorDetails(message)
      toast.error(`${t('speech.transcriptionFailed')}: ${message}`)
    } finally {
      clearInFlightRequest()
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('speech.speechToTextTitle')}</DialogTitle>
          <DialogDescription>{t('speech.speechToTextDescription')}</DialogDescription>
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
                list="speech-to-text-model-list"
                placeholder="whisper-1"
              />
              <datalist id="speech-to-text-model-list">
                {sttModels.map((model) => (
                  <option key={model.id} value={model.id} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('speech.audioFile')}</p>
            <Input
              type="file"
              accept="audio/*,.mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,.ogg,.flac"
              onChange={(event) => {
                setAudioFile(event.target.files?.[0] || null)
              }}
            />
            {audioFile?.name && (
              <p className="text-xs text-muted-foreground truncate">
                {audioFile.name}
              </p>
            )}
          </div>

          <Button
            onClick={handleTranscribe}
            disabled={isLoading || !audioFile || !activeProvider?.base_url}
          >
            {isLoading ? t('speech.transcribing') : t('speech.transcribe')}
          </Button>
          {!activeProvider?.base_url && (
            <p className="text-xs text-muted-foreground">
              {t('speech.providerMissing')}
            </p>
          )}
          {errorDetails && (
            <p className="text-xs text-destructive break-words">{errorDetails}</p>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('speech.transcript')}</p>
            <Textarea
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              className="min-h-40"
              placeholder={t('speech.transcriptPlaceholder')}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
