type Language = 'en' | 'fr' | 'zh-CN' | 'zh-TW' | 'de-DE' | 'ja' | 'pt-BR' | 'ru'
interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}

type ErrorObject = {
  code?: string
  message: string
  details?: string
}
