// GGUF metadata reading + model-support estimation — port of
// src-tauri/plugins/tauri-plugin-llamacpp/src/gguf/.
import fs from 'node:fs'
import { getSystemInfo } from '../hardware/index.js'

export interface GgufMetadata {
  version: number
  tensor_count: number
  metadata: Record<string, string>
}

const GGUF_VALUE_TYPE_NAMES = [
  'Uint8',
  'Int8',
  'Uint16',
  'Int16',
  'Uint32',
  'Int32',
  'Float32',
  'Bool',
  'String',
  'Array',
  'Uint64',
  'Int64',
  'Float64',
] as const

/** Minimal byte reader over either a file descriptor or an in-memory buffer. */
interface GgufReader {
  readBytes(n: number): Buffer
  skip(n: number): void
}

function fdReader(fd: number): GgufReader {
  return {
    readBytes(n: number): Buffer {
      const buffer = Buffer.alloc(n)
      let offset = 0
      while (offset < n) {
        const read = fs.readSync(fd, buffer, offset, n - offset, null)
        if (read === 0) throw new Error('Unexpected end of GGUF data')
        offset += read
      }
      return buffer
    },
    skip(n: number): void {
      const chunk = Buffer.alloc(Math.min(n, 1024 * 1024))
      let remaining = n
      while (remaining > 0) {
        const want = Math.min(remaining, chunk.length)
        const read = fs.readSync(fd, chunk, 0, want, null)
        if (read === 0) throw new Error('Unexpected end of GGUF data')
        remaining -= read
      }
    },
  }
}

function bufferReader(buffer: Buffer): GgufReader {
  let offset = 0
  return {
    readBytes(n: number): Buffer {
      if (offset + n > buffer.length) throw new Error('Unexpected end of GGUF data')
      const slice = buffer.subarray(offset, offset + n)
      offset += n
      return slice
    },
    skip(n: number): void {
      if (offset + n > buffer.length) throw new Error('Unexpected end of GGUF data')
      offset += n
    },
  }
}

class NeedMoreData extends Error {}

function readU8(reader: GgufReader): number {
  return reader.readBytes(1).readUInt8(0)
}

function readU32(reader: GgufReader): number {
  return reader.readBytes(4).readUInt32LE(0)
}

function readU64(reader: GgufReader): bigint {
  return reader.readBytes(8).readBigUInt64LE(0)
}

function readGgufString(reader: GgufReader): string {
  const len = readU64(reader)
  if (len > 1024n * 1024n) {
    throw new Error(`String length ${len} is unreasonably large`)
  }
  return reader.readBytes(Number(len)).toString('utf8')
}

function valueTypeName(valueType: number): string {
  const name = GGUF_VALUE_TYPE_NAMES[valueType]
  if (name === undefined) throw new Error(`Unknown GGUF value type: ${valueType}`)
  return name
}

function readGgufValue(reader: GgufReader, valueType: number): string {
  switch (valueType) {
    case 0:
      return String(readU8(reader))
    case 1:
      return String(reader.readBytes(1).readInt8(0))
    case 2:
      return String(reader.readBytes(2).readUInt16LE(0))
    case 3:
      return String(reader.readBytes(2).readInt16LE(0))
    case 4:
      return String(readU32(reader))
    case 5:
      return String(reader.readBytes(4).readInt32LE(0))
    case 6:
      return String(reader.readBytes(4).readFloatLE(0))
    case 7:
      return readU8(reader) !== 0 ? 'true' : 'false'
    case 8:
      return readGgufString(reader)
    case 9: {
      const elemType = readU32(reader)
      const elemName = valueTypeName(elemType)
      const len = readU64(reader)
      if (len > 1_000_000n) {
        throw new Error(`Array length ${len} is unreasonably large`)
      }
      if (len > 24n) {
        skipArrayData(reader, elemType, len)
        return `<Array of type ${elemName} with ${len} elements, data skipped>`
      }
      const elems: string[] = []
      for (let i = 0n; i < len; i++) {
        elems.push(readGgufValue(reader, elemType))
      }
      return `[${elems.join(', ')}]`
    }
    case 10:
      return readU64(reader).toString()
    case 11:
      return reader.readBytes(8).readBigInt64LE(0).toString()
    case 12:
      return String(reader.readBytes(8).readDoubleLE(0))
    default:
      throw new Error(`Unknown GGUF value type: ${valueType}`)
  }
}

function skipArrayData(reader: GgufReader, elemType: number, len: bigint): void {
  switch (elemType) {
    case 0: // Uint8
    case 1: // Int8
    case 7: // Bool
      reader.skip(Number(len))
      return
    case 2: // Uint16
    case 3: // Int16
      reader.skip(Number(len) * 2)
      return
    case 4: // Uint32
    case 5: // Int32
    case 6: // Float32
      reader.skip(Number(len) * 4)
      return
    case 10: // Uint64
    case 11: // Int64
    case 12: // Float64
      reader.skip(Number(len) * 8)
      return
    case 8: // String
      for (let i = 0n; i < len; i++) {
        const strLen = readU64(reader)
        reader.skip(Number(strLen))
      }
      return
    default:
      // Nested arrays: Rust recursively reads (rare in practice).
      for (let i = 0n; i < len; i++) {
        readGgufValue(reader, elemType)
      }
  }
}

/** Port of `helpers::read_gguf_metadata`. */
export function parseGgufMetadata(reader: GgufReader): GgufMetadata {
  const magic = reader.readBytes(4)
  if (magic.toString('latin1') !== 'GGUF') {
    throw new NeedMoreData('Not a GGUF file')
  }
  const version = readU32(reader)
  const tensorCount = readU64(reader)
  const metadataCount = readU64(reader)

  const metadata: Record<string, string> = {}
  for (let i = 0n; i < metadataCount; i++) {
    const key = readGgufString(reader)
    const valueType = readU32(reader)
    metadata[key] = readGgufValue(reader, valueType)
  }

  return { version, tensor_count: Number(tensorCount), metadata }
}

/**
 * Port of `read_gguf_metadata_internal`: local files stream from disk; remote
 * URLs are fetched in 2MB Range chunks (up to 120MB) until the header parses.
 */
export async function readGgufMetadata(path: string): Promise<GgufMetadata> {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const chunkSize = 2 * 1024 * 1024
    const maxTotalSize = 120 * 1024 * 1024
    const chunks: Buffer[] = []
    let totalDownloaded = 0

    while (totalDownloaded < maxTotalSize) {
      const start = totalDownloaded
      const end = Math.min(start + chunkSize - 1, maxTotalSize - 1)
      const response = await fetch(path, { headers: { Range: `bytes=${start}-${end}` } })
      if (!response.ok && response.status !== 206) {
        throw new Error(`Failed to fetch chunk ${start}-${end}: HTTP ${response.status}`)
      }
      const chunkData = Buffer.from(await response.arrayBuffer())
      chunks.push(chunkData)
      totalDownloaded += chunkData.length

      try {
        return parseGgufMetadata(bufferReader(Buffer.concat(chunks)))
      } catch {
        // not enough data yet — fetch the next chunk
      }
      if (chunkData.length < chunkSize) break
    }
    throw new Error('Could not parse GGUF metadata from downloaded data')
  }

  const fd = fs.openSync(path, 'r')
  try {
    return parseGgufMetadata(fdReader(fd))
  } catch (error) {
    throw new Error(`Failed to parse GGUF metadata: ${String(error)}`)
  } finally {
    fs.closeSync(fd)
  }
}

export interface KVCacheEstimate {
  size: number
  per_token_size: number
}

function parsePositive(meta: Record<string, string>, key: string): number | null {
  const raw = meta[key]
  if (raw === undefined) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Port of `estimate_kv_cache_internal`. */
export function estimateKVCacheSize(meta: Record<string, string>, ctxSize?: number): KVCacheEstimate {
  const arch = meta['general.architecture']
  if (arch === undefined) {
    throw new Error('Invalid metadata: architecture not found')
  }

  const nLayer = parsePositive(meta, `${arch}.block_count`)
  if (nLayer === null) {
    throw new Error('Invalid metadata: block_count not found or invalid')
  }

  const nHeadKv = parsePositive(meta, `${arch}.attention.head_count_kv`)
  const nHeadTotal = parsePositive(meta, `${arch}.attention.head_count`) ?? 0
  const nHead = nHeadKv ?? nHeadTotal
  if (nHead === 0) {
    throw new Error('Invalid metadata: head_count not found or invalid')
  }

  let keyLen = parsePositive(meta, `${arch}.attention.key_length`) ?? 0
  let valLen = parsePositive(meta, `${arch}.attention.value_length`) ?? 0

  // Fallback: derive head_dim from embedding_length / total heads.
  if (keyLen === 0 || valLen === 0) {
    const embLen = parsePositive(meta, `${arch}.embedding_length`) ?? 0
    if (embLen > 0 && nHead > 0) {
      const totalHeads = nHeadTotal > 0 ? nHeadTotal : nHead
      const headDim = Math.floor(embLen / totalHeads)
      keyLen = headDim
      valLen = headDim
    }
  }
  if (keyLen === 0 || valLen === 0) {
    throw new Error('Invalid metadata: embedding_length not found or invalid')
  }

  const maxCtx = parsePositive(meta, `${arch}.context_length`)
  if (maxCtx === null) {
    throw new Error('Invalid metadata: context_length not found or invalid')
  }
  const ctxLen = ctxSize !== undefined ? Math.min(ctxSize, maxCtx) : maxCtx

  const slidingWindow = parsePositive(meta, `${arch}.attention.sliding_window`)

  const BYTES_PER_ELEMENT = 2 // assume fp16
  const kvPerToken = nLayer * nHead * (keyLen + valLen) * BYTES_PER_ELEMENT
  const fullCost = ctxLen * kvPerToken

  const size =
    slidingWindow !== null ? Math.floor((fullCost + slidingWindow * kvPerToken) / 2) : fullCost

  return { size, per_token_size: kvPerToken }
}

const ALLOWED_MODEL_URL_HOSTS = [
  'huggingface.co',
  'hf.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
]

/** Port of `is_allowed_model_url` (scheme + host allowlist + literal-IP check). */
function assertAllowedModelUrl(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch (error) {
    throw new Error(`Invalid URL: ${String(error)}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are allowed for model metadata')
  }
  const host = url.hostname.toLowerCase()
  if (host.length === 0) throw new Error('URL has no host')
  const allowed = ALLOWED_MODEL_URL_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )
  if (!allowed) {
    throw new Error(`Model metadata URL host '${host}' is not in the allowlist`)
  }
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error('Model metadata URL resolves to an internal/private address')
  }
}

function isPrivateOrLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '[::1]') return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/** Port of `get_model_size`. */
export async function getModelSize(path: string): Promise<number> {
  if (path.startsWith('https://') || path.startsWith('http://')) {
    assertAllowedModelUrl(path)
    const response = await fetch(path, { method: 'HEAD' })
    const contentLength = response.headers.get('content-length')
    if (contentLength === null) {
      throw new Error('Server did not return content-length header')
    }
    const size = Number.parseInt(contentLength, 10)
    if (!Number.isFinite(size)) {
      throw new Error(`Failed to parse content-length: ${contentLength}`)
    }
    return size
  }
  try {
    return fs.statSync(path).size
  } catch (error) {
    throw new Error(`Failed to get file metadata: ${String(error)}`)
  }
}

const RESERVE_BYTES = 2_288_490_189

/** Port of `is_model_supported`. */
export async function isModelSupported(
  path: string,
  ctxSize?: number,
): Promise<'RED' | 'YELLOW' | 'GREEN'> {
  const modelSize = await getModelSize(path)
  const systemInfo = await getSystemInfo()
  const gguf = await readGgufMetadata(path)
  const kvCacheSize = estimateKVCacheSize(gguf.metadata, ctxSize).size

  const totalRequired = modelSize + kvCacheSize

  // On macOS with unified memory, GPU info may be empty; treat RAM as VRAM and
  // RAM = 0 for the combined total (matches the Rust logic).
  const totalSystemMemory =
    systemInfo.gpus.length === 0 ? 0 : systemInfo.total_memory * 1024 * 1024
  const totalVram =
    systemInfo.gpus.length === 0
      ? systemInfo.total_memory * 1024 * 1024
      : systemInfo.gpus.reduce((sum, gpu) => sum + gpu.total_memory * 1024 * 1024, 0)

  const usableVram = Math.max(0, totalVram - RESERVE_BYTES)
  const usableTotalMemory = Math.max(0, totalSystemMemory - RESERVE_BYTES) + usableVram

  if (totalRequired > usableTotalMemory) return 'RED'
  if (totalRequired <= usableVram) return 'GREEN'
  return 'YELLOW'
}
