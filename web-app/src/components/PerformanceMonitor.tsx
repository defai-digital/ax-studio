import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Cpu,
  ChevronDown,
  ChevronUp,
  Zap,
  Activity,
  MemoryStick,
} from 'lucide-react'
import { useHardware } from '@/hooks/settings/useHardware'
import { useAppState } from '@/hooks/settings/useAppState'
import { getServiceHub } from '@/hooks/useServiceHub'

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function MeterBar({
  value,
  max,
  color,
}: {
  value: number
  max: number
  color: string
}) {
  const pct = clamp((value / max) * 100, 0, 100)
  const barColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : color

  return (
    <div
      className="flex-1 h-1.5 rounded-full overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.06)' }}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: barColor }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </div>
  )
}

function StatusDot({
  status,
}: {
  status: 'active' | 'idle' | 'loading'
}) {
  const colors = {
    active: '#22c55e',
    idle: '#f59e0b',
    loading: '#6366f1',
  }
  return (
    <span className="relative flex items-center justify-center size-2">
      {status === 'active' && (
        <motion.span
          className="absolute inline-flex rounded-full size-2 opacity-60"
          style={{ background: colors[status] }}
          animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
      <span
        className="relative inline-flex rounded-full size-2"
        style={{ background: colors[status] }}
      />
    </span>
  )
}

export function PerformanceMonitor() {
  const [expanded, setExpanded] = useState(false)

  const systemUsage = useHardware((s) => s.systemUsage)
  const updateSystemUsage = useHardware((s) => s.updateSystemUsage)
  const hardwareData = useHardware((s) => s.hardwareData)
  const serverStatus = useAppState((s) => s.serverStatus)
  const tokenSpeed = useAppState((s) => s.tokenSpeed)

  const pollRef = useRef<ReturnType<typeof setInterval>>()
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const hub = getServiceHub()
        const usage = await hub.hardware().getSystemUsage()
        if (!cancelled && usage) updateSystemUsage(usage)
      } catch { /* ignore during shutdown */ }
    }
    poll()
    pollRef.current = setInterval(poll, 5000)
    return () => { cancelled = true; clearInterval(pollRef.current) }
  }, [updateSystemUsage])

  const status: 'active' | 'idle' | 'loading' =
    serverStatus === 'running'
      ? 'active'
      : serverStatus === 'pending'
        ? 'loading'
        : 'idle'

  const cpuPercent = Math.round(systemUsage.cpu)
  const ramUsedGB = +(systemUsage.used_memory / 1024 / 1024 / 1024).toFixed(1)
  const ramTotalGB = +(systemUsage.total_memory / 1024 / 1024 / 1024).toFixed(1)

  const gpu = systemUsage.gpus?.[0]
  const gpuUsedGB = gpu ? +(gpu.used_memory / 1024).toFixed(1) : 0
  const gpuTotalGB = gpu ? +(gpu.total_memory / 1024).toFixed(1) : 0

  const tps = tokenSpeed?.tokenSpeed ?? 0

  const statusLabel =
    status === 'active'
      ? `${tps.toFixed(1)} t/s`
      : status === 'loading'
        ? 'Loading…'
        : 'Idle'

  const statusColor =
    status === 'active'
      ? '#22c55e'
      : status === 'loading'
        ? '#818cf8'
        : '#f59e0b'

  return (
    <div
      className="mx-3 mb-1 rounded-xl border overflow-hidden group-data-[collapsible=icon]:hidden"
      style={{
        borderColor: 'var(--sidebar-border)',
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sidebar-accent/40 transition-colors"
      >
        <StatusDot status={status} />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span
            className="truncate text-sidebar-foreground/70"
            style={{ fontSize: '11px' }}
          >
            {hardwareData.cpu?.name
              ? hardwareData.cpu.name.split(' ').slice(0, 3).join(' ')
              : 'System'}
          </span>
          <AnimatePresence mode="wait">
            <motion.span
              key={status}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              className={status === 'active' ? 'perf-live shrink-0' : 'shrink-0'}
              style={{ fontSize: '11px', color: statusColor }}
            >
              {statusLabel}
            </motion.span>
          </AnimatePresence>
        </div>
        {expanded ? (
          <ChevronUp className="size-3 text-sidebar-foreground/30 shrink-0" />
        ) : (
          <ChevronDown className="size-3 text-sidebar-foreground/30 shrink-0" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              className="px-3 pb-3 space-y-2.5 border-t"
              style={{ borderColor: 'var(--sidebar-border)' }}
            >
              {/* Token speed */}
              <div className="pt-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Zap className="size-2.5 text-indigo-400" />
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--sidebar-foreground)',
                        opacity: 0.5,
                      }}
                    >
                      Tokens / sec
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#818cf8',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {status === 'active' ? tps.toFixed(1) : '—'}
                  </span>
                </div>
              </div>

              {/* GPU VRAM (if available) */}
              {gpu && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <MemoryStick className="size-2.5 text-violet-400" />
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--sidebar-foreground)',
                          opacity: 0.5,
                        }}
                      >
                        VRAM
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--sidebar-foreground)',
                        opacity: 0.6,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {gpuUsedGB} / {gpuTotalGB} GB
                    </span>
                  </div>
                  <MeterBar
                    value={gpuUsedGB}
                    max={gpuTotalGB || 1}
                    color="#a78bfa"
                  />
                </div>
              )}

              {/* CPU */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Cpu className="size-2.5 text-blue-400" />
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--sidebar-foreground)',
                        opacity: 0.5,
                      }}
                    >
                      CPU
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--sidebar-foreground)',
                      opacity: 0.6,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {cpuPercent}%
                  </span>
                </div>
                <MeterBar value={cpuPercent} max={100} color="#60a5fa" />
              </div>

              {/* RAM */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Activity className="size-2.5 text-emerald-400" />
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--sidebar-foreground)',
                        opacity: 0.5,
                      }}
                    >
                      RAM
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '11px',
                      color: 'var(--sidebar-foreground)',
                      opacity: 0.6,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {ramUsedGB} / {ramTotalGB} GB
                  </span>
                </div>
                <MeterBar
                  value={ramUsedGB}
                  max={ramTotalGB || 1}
                  color="#34d399"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
