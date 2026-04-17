type Language = 'en' | 'fr' | 'zh-CN' | 'zh-TW' | 'de-DE' | 'ja' | 'ru'
interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}
