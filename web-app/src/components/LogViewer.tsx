import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useServiceHub } from '@/hooks/useServiceHub'
import type { LogEntry } from '@/services/app/types'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState } from 'react'

const SERVER_LOG_TARGET = 'app_lib::core::server::proxy'
const LOG_EVENT_NAME = 'log://log'
const MAX_LOGS = 1_000

export function LogViewer() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const serviceHub = useServiceHub()

  const rowVirtualizer = useVirtualizer({
    count: logs.length,
    getScrollElement: () => logsContainerRef.current,
    estimateSize: () => 20,
    overscan: 10,
  })

  // Scroll to bottom when new logs arrive
  useEffect(() => {
    if (logs.length > 0) {
      rowVirtualizer.scrollToIndex(logs.length - 1, { align: 'end' })
    }
  }, [logs.length, rowVirtualizer])

  // Initial load + live subscription
  useEffect(() => {
    let isMounted = true
    let unsubscribe = () => {}

    serviceHub
      .app()
      .readLogs()
      .then((logData) => {
        const filtered = logData
          .filter((log) => log?.target === SERVER_LOG_TARGET)
          .filter(Boolean) as LogEntry[]
        if (isMounted) {
          setLogs(filtered.slice(-MAX_LOGS))
        }
      })
      .catch((error) => {
        console.error('[LogViewer] Failed to read initial logs:', error)
      })

    serviceHub
      .events()
      .listen(LOG_EVENT_NAME, (event) => {
        const { message } = event.payload as { message: string }
        const log: LogEntry | undefined = serviceHub.app().parseLogLine(message)
        if (log?.target === SERVER_LOG_TARGET) {
          setLogs((prev) => {
            const next = [...prev, log]
            return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
          })
        }
      })
      .then((unsub) => {
        if (isMounted) {
          unsubscribe = unsub
        } else {
          unsub()
        }
      })
      .catch((error) => {
        console.error('[LogViewer] Failed to subscribe to log events:', error)
      })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [serviceHub])

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error': return 'text-red-500'
      case 'warn':  return 'text-yellow-500'
      case 'info':  return 'text-blue-500'
      default:      return 'text-gray-500'
    }
  }

  const formatTimestamp = (timestamp: string | number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const virtualItems = rowVirtualizer.getVirtualItems()

  return (
    <div
      ref={logsContainerRef}
      className="border h-full rounded-md bg-background p-4 px-2 block overflow-y-auto overflow-hidden"
    >
      {logs.length === 0 ? (
        <div className="text-center text-muted-foreground py-4 font-mono text-xs">
          {t('logs:noLogs')}
        </div>
      ) : (
        <div
          className="font-mono text-xs relative"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
            }}
          >
            {virtualItems.map((virtualRow) => {
              const log = logs[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="mb-1 flex"
                >
                  <span className="text-muted-foreground mr-2 shrink-0">
                    [{formatTimestamp(log.timestamp)}]
                  </span>
                  <span className={`mr-2 font-semibold shrink-0 ${getLogLevelColor(log.level)}`}>
                    {log.level.toUpperCase()}
                  </span>
                  <span className="break-all">{log.message}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
