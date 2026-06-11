type AppTheme = 'auto' | 'light' | 'dark'
type Language = 'en' | 'fr' | 'zh-CN' | 'zh-TW' | 'ja'
interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}
