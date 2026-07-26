// Hardware info — Node port of src-tauri/plugins/tauri-plugin-hardware/.
//
// CPU/RAM come from the `os` module. GPU probing is best-effort with no extra
// npm deps: NVIDIA via `nvidia-smi` (the CLI equivalent of the Rust NVML
// probe), Vulkan via `vulkaninfo --summary` when installed. Missing probes
// yield degraded-but-correctly-shaped data (empty gpu lists / zeroed usage),
// matching the Rust plugin's behavior when NVML/Vulkan are unavailable.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'

export interface NvidiaInfo {
  index: number
  compute_capability: string
}

export interface VulkanInfo {
  index: number
  device_type: string
  api_version: string
  device_id: number
}

export interface GpuInfo {
  name: string
  total_memory: number // MiB
  vendor: string
  uuid: string
  driver_version: string
  nvidia_info: NvidiaInfo | null
  vulkan_info: VulkanInfo | null
}

export interface CpuStaticInfo {
  name: string
  core_count: number
  arch: string
  extensions: string[]
}

export interface SystemInfo {
  cpu: CpuStaticInfo
  os_type: string
  os_name: string
  total_memory: number // MiB
  gpus: GpuInfo[]
}

export interface GpuUsage {
  uuid: string
  used_memory: number // MiB
  total_memory: number // MiB
}

export interface SystemUsage {
  cpu: number // percent
  used_memory: number // MiB
  total_memory: number // MiB
  gpus: GpuUsage[]
}

const VENDOR_IDS: Record<number, string> = {
  0x1002: 'AMD',
  0x10de: 'NVIDIA',
  0x8086: 'Intel',
}

function mib(bytes: number): number {
  return Math.floor(bytes / (1024 * 1024))
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        resolve(stdout ?? '')
      },
    )
  })
}

// ─── CPU ────────────────────────────────────────────────────────────────────

function osTypeString(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    default:
      return process.platform // 'linux', 'freebsd', ...
  }
}

function cpuArchString(): string {
  switch (process.arch) {
    case 'x64':
      return 'x86_64'
    case 'arm64':
      return 'aarch64'
    default:
      return process.arch
  }
}

/**
 * Rust feature name → /proc/cpuinfo flag name (only entries that differ or
 * need mapping; flags identical to the Rust name are passed through).
 */
const CPUINFO_FLAG_MAP: Record<string, string> = {
  sse4_1: 'sse4_1',
  sse4_2: 'sse4_2',
  avx512_f: 'avx512f',
  avx512_dq: 'avx512dq',
  avx512_ifma: 'avx512ifma',
  avx512_pf: 'avx512pf',
  avx512_er: 'avx512er',
  avx512_cd: 'avx512cd',
  avx512_bw: 'avx512bw',
  avx512_vl: 'avx512vl',
  avx512_vbmi: 'avx512vbmi',
  avx512_vbmi2: 'avx512vbmi2',
  avx512_vnni: 'avx512vnni',
  avx512_bitalg: 'avx512bitalg',
  avx512_vpopcntdq: 'avx512vpopcntdq',
  avx512_vp2intersect: 'avx512vp2intersect',
}

const SIMPLE_X86_FLAGS = [
  'fpu',
  'mmx',
  'sse',
  'sse2',
  'sse3',
  'ssse3',
  'pclmulqdq',
  'avx',
  'avx2',
  'aes',
  'f16c',
]

async function detectCpuExtensions(): Promise<string[]> {
  if (process.arch !== 'x64' && process.arch !== 'ia32') return []
  const extensions: string[] = []
  const addFromFlags = (flags: Set<string>): void => {
    for (const flag of SIMPLE_X86_FLAGS) {
      if (flags.has(flag)) extensions.push(flag)
    }
    for (const [rustName, cpuinfoName] of Object.entries(CPUINFO_FLAG_MAP)) {
      if (flags.has(cpuinfoName)) extensions.push(rustName)
    }
  }

  if (process.platform === 'linux') {
    try {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8')
      const flagsLine = cpuinfo
        .split('\n')
        .find((line) => line.startsWith('flags'))
      if (flagsLine) {
        addFromFlags(new Set(flagsLine.split(':')[1].trim().split(/\s+/)))
      }
    } catch {
      // no /proc/cpuinfo — degraded
    }
    return extensions
  }

  if (process.platform === 'darwin') {
    // Intel Macs only; Apple Silicon returns [] (matches the Rust non-x86 path).
    const [features, leaf7] = await Promise.all([
      runCommand('sysctl', ['-n', 'machdep.cpu.features'], 3_000),
      runCommand('sysctl', ['-n', 'machdep.cpu.leaf7_features'], 3_000),
    ])
    const flags = new Set(
      `${features ?? ''} ${leaf7 ?? ''}`
        .split(/\s+/)
        .filter((f) => f.length > 0)
        .map((f) => f.toLowerCase()),
    )
    addFromFlags(flags)
    return extensions
  }

  return []
}

// ─── NVIDIA (nvidia-smi, mirrors vendor/nvidia.rs) ──────────────────────────

async function probeNvidiaGpus(): Promise<GpuInfo[]> {
  const stdout = await runCommand(
    'nvidia-smi',
    [
      '--query-gpu=index,name,memory.total,driver_version,uuid,compute_cap',
      '--format=csv,noheader,nounits',
    ],
    10_000,
  )
  if (stdout === null) return []

  const gpus: GpuInfo[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const fields = trimmed.split(',').map((field) => field.trim())
    if (fields.length < 6) continue
    const [indexStr, name, memoryStr, driverVersion, rawUuid, computeCap] = fields
    const index = Number.parseInt(indexStr, 10)
    const totalMemory = Number.parseInt(memoryStr, 10)
    if (!Number.isFinite(index) || !Number.isFinite(totalMemory)) continue
    gpus.push({
      name,
      total_memory: totalMemory,
      vendor: 'NVIDIA',
      uuid: rawUuid.startsWith('GPU-') ? rawUuid.slice(4) : rawUuid,
      driver_version: driverVersion,
      nvidia_info: { index, compute_capability: computeCap },
      vulkan_info: null,
    })
  }
  return gpus
}

async function probeNvidiaUsage(): Promise<Map<number, { used: number; total: number }>> {
  const usage = new Map<number, { used: number; total: number }>()
  const stdout = await runCommand(
    'nvidia-smi',
    ['--query-gpu=index,memory.used,memory.total', '--format=csv,noheader,nounits'],
    10_000,
  )
  if (stdout === null) return usage
  for (const line of stdout.split('\n')) {
    const fields = line
      .trim()
      .split(',')
      .map((field) => field.trim())
    if (fields.length < 3) continue
    const index = Number.parseInt(fields[0], 10)
    const used = Number.parseInt(fields[1], 10)
    const total = Number.parseInt(fields[2], 10)
    if (Number.isFinite(index) && Number.isFinite(used) && Number.isFinite(total)) {
      usage.set(index, { used, total })
    }
  }
  return usage
}

// ─── Vulkan (vulkaninfo, mirrors vendor/vulkan.rs) ─────────────────────────

const VULKAN_DEVICE_TYPE_MAP: Record<string, string> = {
  PHYSICAL_DEVICE_TYPE_DISCRETE_GPU: 'DiscreteGpu',
  PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU: 'IntegratedGpu',
  PHYSICAL_DEVICE_TYPE_VIRTUAL_GPU: 'VirtualGpu',
}

async function probeVulkanGpus(): Promise<GpuInfo[]> {
  const stdout = await runCommand('vulkaninfo', ['--summary'], 10_000)
  if (stdout === null) return []

  const gpus: GpuInfo[] = []
  // `vulkaninfo --summary` prints a "GPU<n>:" block per device with
  // deviceName / apiVersion / driverVersion / vendorID / deviceID lines.
  const blocks = stdout.split(/^GPU\d+:/m).slice(1)
  let index = 0
  for (const block of blocks) {
    const get = (key: string): string | null => {
      const match = new RegExp(`${key}\\s*=\\s*(.+)`).exec(block)
      return match ? match[1].trim() : null
    }
    const name = get('deviceName')
    const apiVersion = get('apiVersion')
    const vendorIdRaw = get('vendorID')
    const deviceIdRaw = get('deviceID')
    const deviceTypeRaw = get('deviceType')
    if (!name) continue
    // Skip CPU implementations (llvmpipe/lavapipe), as the Rust probe does.
    if (
      deviceTypeRaw === 'PHYSICAL_DEVICE_TYPE_CPU' ||
      /llvmpipe|lavapipe|swiftshader/i.test(name)
    ) {
      continue
    }
    const vendorId = vendorIdRaw ? Number.parseInt(vendorIdRaw, 16) || 0 : 0
    const deviceId = deviceIdRaw ? Number.parseInt(deviceIdRaw, 16) || 0 : 0
    gpus.push({
      name,
      total_memory: 0, // vulkaninfo --summary does not report heap sizes
      vendor: VENDOR_IDS[vendorId] ?? `Unknown (vendor_id: ${vendorId})`,
      uuid: `vulkan-gpu-${index}-${deviceId}`,
      driver_version: get('driverVersion') ?? '',
      nvidia_info: null,
      vulkan_info: {
        index,
        device_type: deviceTypeRaw ? (VULKAN_DEVICE_TYPE_MAP[deviceTypeRaw] ?? 'Other') : 'Other',
        api_version: apiVersion ?? '',
        device_id: deviceId,
      },
    })
    index += 1
  }
  return gpus
}

// ─── AMD usage on Linux (mirrors vendor/amd.rs) ─────────────────────────────

function probeAmdUsageLinux(deviceId: number): { used: number; total: number } | null {
  if (process.platform !== 'linux') return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync('/sys/class/drm', { withFileTypes: true })
  } catch {
    return null
  }
  const readMem = (p: string): number => {
    try {
      return Math.floor(Number.parseInt(fs.readFileSync(p, 'utf8').trim(), 10) / (1024 * 1024)) || 0
    } catch {
      return 0
    }
  }
  for (const entry of entries) {
    const devicePath = `/sys/class/drm/${entry.name}/device`
    try {
      if (!fs.existsSync(`${devicePath}/driver/module/drivers/pci:amdgpu`)) continue
      const raw = fs.readFileSync(`${devicePath}/device`, 'utf8').trim()
      const thisDeviceId = Number.parseInt(raw.replace(/^0x/, ''), 16)
      if (thisDeviceId !== deviceId) continue
      return {
        total: readMem(`${devicePath}/mem_info_vram_total`),
        used: readMem(`${devicePath}/mem_info_vram_used`),
      }
    } catch {
      continue
    }
  }
  return null
}

// ─── Public API ─────────────────────────────────────────────────────────────

let cachedSystemInfo: Promise<SystemInfo> | null = null

/** Port of `get_system_info` (cached like the Rust OnceLock). */
export function getSystemInfo(): Promise<SystemInfo> {
  cachedSystemInfo ??= buildSystemInfo().catch((error) => {
    console.error('[hardware] Failed to collect system info:', error)
    return {
      cpu: { name: 'Unknown', core_count: 0, arch: cpuArchString(), extensions: [] },
      os_type: osTypeString(),
      os_name: 'Unknown',
      total_memory: 0,
      gpus: [],
    }
  })
  return cachedSystemInfo
}

async function buildSystemInfo(): Promise<SystemInfo> {
  const gpuMap = new Map<string, GpuInfo>()
  for (const gpu of await probeNvidiaGpus()) {
    gpuMap.set(gpu.uuid, gpu)
  }
  for (const gpu of await probeVulkanGpus()) {
    const existing = gpuMap.get(gpu.uuid)
    if (existing) {
      existing.vulkan_info = gpu.vulkan_info
    } else {
      gpuMap.set(gpu.uuid, gpu)
    }
  }

  const cpus = os.cpus()
  return {
    cpu: {
      name: cpus[0]?.model?.trim() || 'unknown',
      core_count: cpus.length,
      arch: cpuArchString(),
      extensions: await detectCpuExtensions(),
    },
    os_type: osTypeString(),
    os_name: `${os.type()} ${os.release()}`,
    total_memory: mib(os.totalmem()),
    gpus: [...gpuMap.values()],
  }
}

function sampleCpuTimes(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }
  return { idle, total }
}

/** Port of `get_system_usage` (two CPU samples, per-GPU usage best-effort). */
export async function getSystemUsage(): Promise<SystemUsage> {
  const first = sampleCpuTimes()
  await new Promise((resolve) => setTimeout(resolve, 200))
  const second = sampleCpuTimes()

  const idleDelta = second.idle - first.idle
  const totalDelta = second.total - first.total
  const cpuUsage = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0

  const info = await getSystemInfo()
  const nvidiaUsage = info.gpus.some((gpu) => gpu.nvidia_info)
    ? await probeNvidiaUsage()
    : new Map<number, { used: number; total: number }>()

  const gpus: GpuUsage[] = info.gpus.map((gpu) => {
    if (gpu.nvidia_info) {
      const usage = nvidiaUsage.get(gpu.nvidia_info.index)
      if (usage) {
        return { uuid: gpu.uuid, used_memory: usage.used, total_memory: usage.total }
      }
      return { uuid: gpu.uuid, used_memory: 0, total_memory: 0 }
    }
    if (gpu.vendor === 'AMD' && gpu.vulkan_info) {
      const usage = probeAmdUsageLinux(gpu.vulkan_info.device_id)
      if (usage) {
        return { uuid: gpu.uuid, used_memory: usage.used, total_memory: usage.total }
      }
    }
    return { uuid: gpu.uuid, used_memory: 0, total_memory: 0 }
  })

  return {
    cpu: cpuUsage,
    used_memory: mib(os.totalmem() - os.freemem()),
    total_memory: mib(os.totalmem()),
    gpus,
  }
}
