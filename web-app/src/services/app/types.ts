/**
 * App Service Types
 */

export interface LogEntry {
  timestamp: string | number
  level: 'info' | 'warn' | 'error' | 'debug'
  target: string
  message: string
}

export interface AppService {
  factoryReset(): Promise<void>
  readLogs(): Promise<LogEntry[]>
  parseLogLine(line: string): LogEntry
  getAppDataFolder(): Promise<string | undefined>
  relocateAppDataFolder(path: string): Promise<void>
  getServerStatus(): Promise<boolean>
  readYaml<T = unknown>(path: string): Promise<T>
}
