import type { LogEntry } from './types'

const LOG_LINE_MATCHER = /^\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]\s(.*)$/

const NORMALIZED_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error'])

export interface ParseLogLineOptions {
  fallbackTarget?: string
}

function normalizeLogLevel(level: string): LogEntry['level'] {
  const normalized = level.toLowerCase()
  return NORMALIZED_LOG_LEVELS.has(normalized)
    ? (normalized as LogEntry['level'])
    : 'info'
}

export function parseLogLine(
  line: string,
  options: ParseLogLineOptions = {}
): LogEntry {
  const fallbackTarget = options.fallbackTarget ?? 'info'
  const safeLine = line ?? ''
  const match = safeLine.match(LOG_LINE_MATCHER)

  if (!match) {
    return {
      timestamp: Date.now(),
      level: 'info',
      target: fallbackTarget,
      message: safeLine,
    }
  }

  const [, date, time, target, levelRaw, message] = match
  return {
    timestamp: new Date(`${date} ${time}`).getTime(),
    level: normalizeLogLevel(levelRaw),
    target: target,
    message,
  }
}

