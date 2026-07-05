const LOG_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour12: false,
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function formatLogTimestamp(timestamp: string | number): string {
  return LOG_TIME_FORMATTER.format(new Date(timestamp))
}

export function getLogLevelColor(level: string): string {
  switch (level) {
    case 'error':
      return 'text-red-500'
    case 'warn':
      return 'text-yellow-500'
    case 'info':
      return 'text-blue-500'
    default:
      return 'text-gray-500'
  }
}
