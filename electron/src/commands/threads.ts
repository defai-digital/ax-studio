// Thread/message persistence commands (Node port of
// src-tauri/src/core/threads/). Mirrors the Rust on-disk layout exactly so
// existing user data remains compatible:
//
//   <data_folder>/threads/<thread_id>/thread.json      (pretty-printed record)
//   <data_folder>/threads/<thread_id>/messages.jsonl   (one record per line)
//
// Writes are atomic (tmp file + fsync + rename) and serialized per thread.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getAppDataFolderPath } from '../state.js'
import type { CommandHandler } from './registry.js'

type Args = Record<string, unknown>
type JsonRecord = Record<string, unknown>

const THREADS_DIR = 'threads'
const THREADS_FILE = 'thread.json'
const MESSAGES_FILE = 'messages.jsonl'

const MAX_STORAGE_IDENTIFIER_BYTES = 128
const MAX_THREAD_RECORD_BYTES = 4 * 1024 * 1024
const MAX_MESSAGE_RECORD_BYTES = 16 * 1024 * 1024
const MAX_THREAD_ASSISTANTS = 256
const MAX_MESSAGE_CONTENT_ITEMS = 10_000
const MAX_MESSAGES_FILE_BYTES = 512 * 1024 * 1024
const MAX_MESSAGES_PER_THREAD = 1_000_000
const MAX_THREAD_DIR_ENTRIES = 100_000
const THREAD_CACHE_TTL_MS = 5_000

// ─── Paths (src-tauri/src/core/threads/utils.rs) ────────────────────────────

function sanitizeThreadId(threadId: string): string {
  // Rust keeps `char::is_alphanumeric` (Unicode) plus '-' and '_'.
  const sanitized = threadId.replace(/[^\p{L}\p{N}\-_]/gu, '')
  return sanitized.length > 0 ? sanitized : 'invalid'
}

function dataDir(): string {
  return path.join(getAppDataFolderPath(), THREADS_DIR)
}

function threadDir(threadId: string): string {
  return path.join(dataDir(), sanitizeThreadId(threadId))
}

function threadMetadataPath(threadId: string): string {
  return path.join(threadDir(threadId), THREADS_FILE)
}

function messagesPath(threadId: string): string {
  return path.join(threadDir(threadId), MESSAGES_FILE)
}

async function ensureDataDirs(): Promise<void> {
  await fsp.mkdir(dataDir(), { recursive: true })
}

// ─── Validation (src-tauri/src/core/threads/models.rs) ──────────────────────

function validateStorageIdentifier(kind: string, value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_STORAGE_IDENTIFIER_BYTES ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error(
      `${kind} must contain 1-${MAX_STORAGE_IDENTIFIER_BYTES} ASCII letters, digits, '-' or '_'`
    )
  }
}

function serializedSize(record: unknown): number {
  return Buffer.byteLength(JSON.stringify(record ?? null), 'utf8')
}

function validateThreadRecord(thread: JsonRecord): void {
  validateStorageIdentifier('Thread id', thread.id)
  const assistants = Array.isArray(thread.assistants) ? thread.assistants : []
  if (assistants.length > MAX_THREAD_ASSISTANTS) {
    throw new Error(`Thread has more than ${MAX_THREAD_ASSISTANTS} assistants`)
  }
  if (serializedSize(thread) > MAX_THREAD_RECORD_BYTES) {
    throw new Error(`Thread record exceeds the ${MAX_THREAD_RECORD_BYTES}-byte limit`)
  }
}

function validateMessageRecord(message: JsonRecord): void {
  validateStorageIdentifier('Message id', message.id)
  validateStorageIdentifier('Thread id', message.thread_id)
  const content = Array.isArray(message.content) ? message.content : []
  if (content.length > MAX_MESSAGE_CONTENT_ITEMS) {
    throw new Error(`Message has more than ${MAX_MESSAGE_CONTENT_ITEMS} content items`)
  }
  if (serializedSize(message) > MAX_MESSAGE_RECORD_BYTES) {
    throw new Error(`Message record exceeds the ${MAX_MESSAGE_RECORD_BYTES}-byte limit`)
  }
}

/**
 * Legacy files persisted timestamps as `Date.now() / 1000` floats; the Rust
 * deserializer truncates them toward zero on read (heal-on-read). Mirror that
 * so old data keeps loading.
 */
function healTimestamps(record: JsonRecord, fields: string[]): JsonRecord {
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'number' && !Number.isInteger(value)) {
      record[field] = Math.trunc(value)
    }
  }
  return record
}

function parseThreadRecord(data: string): JsonRecord {
  const thread = JSON.parse(data) as JsonRecord
  return healTimestamps(thread, ['created', 'updated'])
}

function parseMessageRecord(line: string): JsonRecord {
  const message = JSON.parse(line) as JsonRecord
  return healTimestamps(message, ['created_at', 'completed_at'])
}

// ─── Per-thread async locks (src-tauri/src/core/threads/helpers.rs) ─────────

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve()
  private held = false

  get idle(): boolean {
    return !this.held
  }

  async acquire(): Promise<() => void> {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const previous = this.tail
    this.tail = this.tail.then(() => gate)
    await previous
    this.held = true
    return () => {
      this.held = false
      release()
    }
  }
}

const threadLocks = new Map<string, AsyncMutex>()

function pruneUnusedLocks(): void {
  // Rust prunes entries with Arc strong_count == 1 (nobody waiting/holding).
  for (const [key, lock] of threadLocks) {
    if (lock.idle) threadLocks.delete(key)
  }
}

function getLockForThread(threadId: string): AsyncMutex {
  pruneUnusedLocks()
  let lock = threadLocks.get(threadId)
  if (!lock) {
    lock = new AsyncMutex()
    threadLocks.set(threadId, lock)
  }
  return lock
}

function removeLockForThread(threadId: string): void {
  threadLocks.delete(threadId)
  pruneUnusedLocks()
}

async function withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const release = await getLockForThread(threadId).acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

// ─── Thread list cache (5s TTL, invalidated on create/modify/delete) ────────

let threadListCache: { entries: JsonRecord[]; populatedAt: number } | null = null

function getCachedThreadList(): JsonRecord[] | null {
  if (threadListCache && Date.now() - threadListCache.populatedAt < THREAD_CACHE_TTL_MS) {
    return threadListCache.entries
  }
  return null
}

function invalidateThreadCache(): void {
  threadListCache = null
}

// ─── File helpers (src-tauri/src/core/threads/helpers.rs) ───────────────────

async function writeFileAtomicSync(target: string, data: string): Promise<void> {
  const tmp = `${target}.tmp`
  await fsp.writeFile(tmp, data, 'utf8')
  const handle = await fsp.open(tmp, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fsp.rename(tmp, target)
  } catch (error) {
    await fsp.unlink(tmp).catch(() => undefined)
    throw error
  }
}

/** Pretty-printed atomic thread.json write (serde_json::to_string_pretty). */
async function updateThreadMetadata(target: string, thread: JsonRecord): Promise<void> {
  await writeFileAtomicSync(target, JSON.stringify(thread, null, 2))
}

async function readMessagesFromPath(
  target: string,
  expectedThreadId: string
): Promise<JsonRecord[]> {
  if (!fs.existsSync(target)) return []
  const stat = await fsp.stat(target)
  if (stat.size > MAX_MESSAGES_FILE_BYTES) {
    throw new Error(`Messages file exceeds the ${MAX_MESSAGES_FILE_BYTES}-byte limit`)
  }
  const content = await fsp.readFile(target, 'utf8')
  const messages: JsonRecord[] = []
  let skipped = 0
  for (const line of content.split('\n')) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_RECORD_BYTES + 1) {
      throw new Error(
        `Message record exceeds the ${MAX_MESSAGE_RECORD_BYTES}-byte limit`
      )
    }
    if (line.trim().length === 0) continue
    let message: JsonRecord
    try {
      message = parseMessageRecord(line)
      validateMessageRecord(message)
    } catch (error) {
      skipped += 1
      console.warn(
        `[threads] skipping malformed message record in ${target}:`,
        (error as Error).message
      )
      continue
    }
    if (message.thread_id !== expectedThreadId) {
      skipped += 1
      console.warn(`[threads] skipping invalid or mismatched message record in ${target}`)
      continue
    }
    if (messages.length >= MAX_MESSAGES_PER_THREAD) {
      throw new Error(`Thread contains more than ${MAX_MESSAGES_PER_THREAD} messages`)
    }
    messages.push(message)
  }
  if (skipped > 0) {
    console.warn(`[threads] ${skipped} message(s) skipped due to malformed JSON in ${target}`)
  }
  return messages
}

/** Key-order-insensitive equality, mirroring Rust's struct PartialEq. */
function recordsEqual(a: JsonRecord, b: JsonRecord): boolean {
  return stableStringify(a) === stableStringify(b)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as JsonRecord)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Rewrite messages.jsonl line by line through `transform` (return null to drop
 * a record). Unlike readMessagesFromPath, malformed lines are a hard error —
 * this mirrors the Rust rewrite_messages_file, which refuses to rewrite a file
 * it cannot fully parse. Returns whether any record changed.
 */
async function rewriteMessagesFile(
  target: string,
  transform: (message: JsonRecord) => JsonRecord | null
): Promise<boolean> {
  if (!fs.existsSync(target)) return false
  const stat = await fsp.stat(target)
  if (stat.size > MAX_MESSAGES_FILE_BYTES) {
    throw new Error(`Messages file exceeds the ${MAX_MESSAGES_FILE_BYTES}-byte limit`)
  }
  const content = await fsp.readFile(target, 'utf8')
  const lines = content.split('\n')
  const out: string[] = []
  let changed = false
  let records = 0
  for (const line of lines) {
    if (line.trim().length === 0) continue
    records += 1
    if (records > MAX_MESSAGES_PER_THREAD) {
      throw new Error(`Thread contains more than ${MAX_MESSAGES_PER_THREAD} messages`)
    }
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_RECORD_BYTES + 1) {
      throw new Error(
        `Message record exceeds the ${MAX_MESSAGE_RECORD_BYTES}-byte limit`
      )
    }
    const message = parseMessageRecord(line)
    validateMessageRecord(message)
    const next = transform(message)
    if (next === null) {
      changed = true
      continue
    }
    validateMessageRecord(next)
    if (!recordsEqual(next, message)) changed = true
    out.push(JSON.stringify(next))
  }
  await writeFileAtomicSync(target, out.length > 0 ? out.join('\n') + '\n' : '')
  return changed
}

// ─── Arg extraction (web-app sends camelCase; accept snake_case too) ────────

function threadIdArg(args: Args | undefined, command: string): string {
  const id = args?.threadId ?? args?.thread_id
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`${command}: missing threadId`)
  }
  return id
}

function recordArg(args: Args | undefined, key: string, command: string): JsonRecord {
  const value = args?.[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${command}: missing ${key}`)
  }
  return { ...(value as JsonRecord) }
}

// ─── Command handlers ───────────────────────────────────────────────────────

export function createThreadsHandlers(): Record<string, CommandHandler> {
  return {
    list_threads: async () => {
      const cached = getCachedThreadList()
      if (cached) return cached

      await ensureDataDirs()
      const dir = dataDir()
      const threads: JsonRecord[] = []
      let skipped = 0
      let scanned = 0
      if (fs.existsSync(dir)) {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          scanned += 1
          if (scanned > MAX_THREAD_DIR_ENTRIES) {
            throw new Error('Thread directory contains more than 100000 entries')
          }
          if (!entry.isDirectory()) continue
          const metadataPath = path.join(dir, entry.name, THREADS_FILE)
          if (!fs.existsSync(metadataPath)) continue
          const stat = await fsp.stat(metadataPath)
          if (stat.size > MAX_THREAD_RECORD_BYTES) {
            skipped += 1
            continue
          }
          try {
            const thread = parseThreadRecord(await fsp.readFile(metadataPath, 'utf8'))
            validateThreadRecord(thread)
            if (entry.name !== thread.id) {
              skipped += 1
              console.warn(
                `[threads] skipping thread metadata with invalid or mismatched id: ${metadataPath}`
              )
              continue
            }
            threads.push(thread)
          } catch (error) {
            skipped += 1
            console.warn(
              `[threads] failed to parse thread metadata ${metadataPath}:`,
              (error as Error).message
            )
          }
        }
      }
      if (skipped > 0) {
        console.warn(`[threads] ${skipped} thread(s) skipped due to malformed metadata`)
      }
      threadListCache = { entries: threads, populatedAt: Date.now() }
      return threads
    },

    create_thread: async (args) => {
      const thread = recordArg(args, 'thread', 'create_thread')
      if (typeof thread.id !== 'string' || thread.id.length === 0) {
        thread.id = randomUUID()
      }
      validateThreadRecord(thread)
      await ensureDataDirs()
      const id = thread.id as string
      const dir = threadDir(id)
      try {
        await fsp.mkdir(dir)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`Thread '${id}' already exists`)
        }
        throw error
      }
      try {
        await updateThreadMetadata(threadMetadataPath(id), thread)
      } catch (error) {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      invalidateThreadCache()
      return thread
    },

    modify_thread: async (args) => {
      const thread = recordArg(args, 'thread', 'modify_thread')
      if (typeof thread.id !== 'string' || thread.id.length === 0) {
        throw new Error('Missing thread id')
      }
      validateThreadRecord(thread)
      const id = thread.id
      if (!fs.existsSync(threadDir(id))) {
        throw new Error('Thread directory does not exist')
      }
      await withThreadLock(id, async () => {
        await updateThreadMetadata(threadMetadataPath(id), thread)
      })
      invalidateThreadCache()
    },

    delete_thread: async (args) => {
      const id = threadIdArg(args, 'delete_thread')
      validateStorageIdentifier('Thread id', id)
      await withThreadLock(id, async () => {
        const dir = threadDir(id)
        if (fs.existsSync(dir)) {
          try {
            await fsp.rm(dir, { recursive: true, force: true })
          } catch (error) {
            throw new Error(`Failed to delete thread directory: ${(error as Error).message}`)
          }
        }
      })
      removeLockForThread(id)
      invalidateThreadCache()
    },

    list_messages: async (args) => {
      const id = threadIdArg(args, 'list_messages')
      validateStorageIdentifier('Thread id', id)
      const messages = await withThreadLock(id, () =>
        readMessagesFromPath(messagesPath(id), id)
      )
      pruneUnusedLocks()
      return messages
    },

    create_message: async (args) => {
      const message = recordArg(args, 'message', 'create_message')
      if (typeof message.id !== 'string' || message.id.length === 0) {
        message.id = randomUUID()
      }
      validateMessageRecord(message)
      const threadId = message.thread_id as string
      const dir = threadDir(threadId)
      if (!fs.existsSync(threadMetadataPath(threadId)) || !fs.statSync(threadMetadataPath(threadId)).isFile()) {
        throw new Error('Cannot create a message for a missing thread')
      }
      await withThreadLock(threadId, async () => {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          throw new Error('Thread directory does not exist')
        }
        await fsp.appendFile(messagesPath(threadId), JSON.stringify(message) + '\n', 'utf8')
      })
      pruneUnusedLocks()
      return message
    },

    modify_message: async (args) => {
      const message = recordArg(args, 'message', 'modify_message')
      if (typeof message.thread_id !== 'string' || message.thread_id.length === 0) {
        throw new Error('Missing thread_id')
      }
      if (typeof message.id !== 'string' || message.id.length === 0) {
        throw new Error('Missing message id')
      }
      validateMessageRecord(message)
      const threadId = message.thread_id
      const messageId = message.id
      await withThreadLock(threadId, async () => {
        const changed = await rewriteMessagesFile(messagesPath(threadId), (existing) =>
          existing.id === messageId ? message : existing
        )
        if (!changed) throw new Error(`Message '${messageId}' not found`)
      })
      pruneUnusedLocks()
      return message
    },

    modify_messages: async (args) => {
      const raw = args?.messages
      if (!Array.isArray(raw)) throw new Error('modify_messages: missing messages')
      const messages = raw.map((m) => ({ ...(m as JsonRecord) }))
      if (messages.length === 0) return []

      const first = messages[0]
      if (typeof first.thread_id !== 'string' || first.thread_id.length === 0) {
        throw new Error('Missing thread_id')
      }
      const threadId = first.thread_id
      const ids = new Set<string>()
      for (const message of messages) {
        validateMessageRecord(message)
        if (message.thread_id !== threadId) {
          throw new Error('All messages in a batch must belong to the same thread')
        }
        if (ids.has(message.id as string)) {
          throw new Error(`Duplicate message id '${message.id}' in batch`)
        }
        ids.add(message.id as string)
      }

      await withThreadLock(threadId, async () => {
        const target = messagesPath(threadId)
        // Verify every requested id exists before rewriting so a partially
        // valid batch cannot commit a subset of its changes.
        const existing = await readMessagesFromPath(target, threadId)
        const existingIds = new Set(existing.map((m) => m.id))
        for (const id of ids) {
          if (!existingIds.has(id)) throw new Error(`Message '${id}' not found`)
        }
        const replacements = new Map(messages.map((m) => [m.id as string, m]))
        await rewriteMessagesFile(target, (existingMessage) =>
          replacements.get(existingMessage.id as string) ?? existingMessage
        )
      })
      pruneUnusedLocks()
      return messages
    },

    delete_message: async (args) => {
      const id = threadIdArg(args, 'delete_message')
      const messageId = args?.messageId ?? args?.message_id
      validateStorageIdentifier('Thread id', id)
      validateStorageIdentifier('Message id', messageId)
      await withThreadLock(id, async () => {
        await rewriteMessagesFile(messagesPath(id), (existing) =>
          existing.id === messageId ? null : existing
        )
      })
      pruneUnusedLocks()
    },

    get_thread_assistant: async (args) => {
      const id = threadIdArg(args, 'get_thread_assistant')
      validateStorageIdentifier('Thread id', id)
      const target = threadMetadataPath(id)
      if (!fs.existsSync(target)) throw new Error('Thread not found')
      const assistant = await withThreadLock(id, async () => {
        const thread = parseThreadRecord(await fsp.readFile(target, 'utf8'))
        validateThreadRecord(thread)
        const assistants = Array.isArray(thread.assistants) ? thread.assistants : []
        if (assistants.length === 0) throw new Error('Assistant not found')
        return assistants[0]
      })
      pruneUnusedLocks()
      return assistant
    },

    create_thread_assistant: async (args) => {
      const id = threadIdArg(args, 'create_thread_assistant')
      validateStorageIdentifier('Thread id', id)
      const assistant = args?.assistant
      if (assistant === undefined) throw new Error('create_thread_assistant: missing assistant')
      const target = threadMetadataPath(id)
      if (!fs.existsSync(target)) throw new Error('Thread not found')
      await withThreadLock(id, async () => {
        const thread = parseThreadRecord(await fsp.readFile(target, 'utf8'))
        const assistants = Array.isArray(thread.assistants) ? thread.assistants : []
        assistants.push(assistant)
        thread.assistants = assistants
        validateThreadRecord(thread)
        await updateThreadMetadata(target, thread)
      })
      pruneUnusedLocks()
      return assistant
    },

    modify_thread_assistant: async (args) => {
      const id = threadIdArg(args, 'modify_thread_assistant')
      validateStorageIdentifier('Thread id', id)
      const assistant = args?.assistant
      if (assistant === null || typeof assistant !== 'object') {
        throw new Error('modify_thread_assistant: missing assistant')
      }
      const assistantId = (assistant as JsonRecord).id
      if (typeof assistantId !== 'string') throw new Error('Missing id')
      const target = threadMetadataPath(id)
      if (!fs.existsSync(target)) throw new Error('Thread not found')
      await withThreadLock(id, async () => {
        const thread = parseThreadRecord(await fsp.readFile(target, 'utf8'))
        const assistants = Array.isArray(thread.assistants) ? thread.assistants : []
        const index = assistants.findIndex(
          (a) => a !== null && typeof a === 'object' && (a as JsonRecord).id === assistantId
        )
        if (index < 0) {
          throw new Error(`Assistant '${assistantId}' not found in thread '${id}'`)
        }
        assistants[index] = assistant
        thread.assistants = assistants
        validateThreadRecord(thread)
        await updateThreadMetadata(target, thread)
      })
      pruneUnusedLocks()
      return assistant
    },
  }
}
