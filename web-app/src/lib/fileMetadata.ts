/**
 * Utility functions for embedding and extracting file metadata from user prompts
 */

export interface FileMetadata {
  id: string
  name: string
  type?: string
  size?: number
  chunkCount?: number
  injectionMode?: 'inline' | 'embeddings'
}

const FILE_METADATA_START = '[ATTACHED_FILES]'
const FILE_METADATA_END = '[/ATTACHED_FILES]'
const FILE_METADATA_FIELD_REGEX =
  /(?:^|,\s*)(file_id|name|type|size|chunks|mode):\s*/g

const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0

const parseNonNegativeInteger = (
  value: string | undefined
): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return undefined

  const parsed = Number(value)
  return isNonNegativeInteger(parsed) ? parsed : undefined
}

/**
 * Legacy key:value line parser. Values that contain `, size:`-style field
 * keys can still collide — prefer the JSON line format for new writes.
 */
const parseMetadataLine = (line: string): Record<string, string> => {
  const map: Record<string, string> = {}
  const matches = Array.from(line.matchAll(FILE_METADATA_FIELD_REGEX))

  matches.forEach((match, index) => {
    const key = match[1]
    if (!key || match.index == null) return

    const valueStart = match.index + match[0].length
    const valueEnd =
      index + 1 < matches.length && matches[index + 1].index != null
        ? matches[index + 1].index
        : line.length

    map[key] = line.slice(valueStart, valueEnd).trim()
  })

  return map
}

const fileFromFieldMap = (map: Record<string, string>): FileMetadata | null => {
  const id = map['file_id']
  const name = map['name']
  if (!id || !name) return null

  const fileObj: FileMetadata = { id, name }
  const type = map['type']
  if (type) fileObj.type = type

  const size = parseNonNegativeInteger(map['size'])
  if (typeof size === 'number') fileObj.size = size

  const chunkCount = parseNonNegativeInteger(map['chunks'])
  if (typeof chunkCount === 'number') fileObj.chunkCount = chunkCount

  const injectionMode = map['mode']
  if (injectionMode === 'inline' || injectionMode === 'embeddings') {
    fileObj.injectionMode = injectionMode
  }

  return fileObj
}

const fileFromJsonLine = (raw: string): FileMetadata | null => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null

    const id = parsed.file_id
    const name = parsed.name
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name) {
      return null
    }

    const fileObj: FileMetadata = { id, name }
    if (typeof parsed.type === 'string' && parsed.type) {
      fileObj.type = parsed.type
    }
    if (
      typeof parsed.size === 'number' &&
      isNonNegativeInteger(parsed.size)
    ) {
      fileObj.size = parsed.size
    }
    if (
      typeof parsed.chunks === 'number' &&
      isNonNegativeInteger(parsed.chunks)
    ) {
      fileObj.chunkCount = parsed.chunks
    }
    if (parsed.mode === 'inline' || parsed.mode === 'embeddings') {
      fileObj.injectionMode = parsed.mode
    }
    return fileObj
  } catch {
    return null
  }
}

const serializeFileLine = (file: FileMetadata): string => {
  // JSON lines avoid delimiter collisions when names/ids contain ", size:" etc.
  const payload: Record<string, string | number> = {
    file_id: file.id,
    name: file.name,
  }
  if (file.type) payload.type = file.type
  if (typeof file.size === 'number' && isNonNegativeInteger(file.size)) {
    payload.size = file.size
  }
  if (
    typeof file.chunkCount === 'number' &&
    isNonNegativeInteger(file.chunkCount)
  ) {
    payload.chunks = file.chunkCount
  }
  if (file.injectionMode) payload.mode = file.injectionMode
  return `- ${JSON.stringify(payload)}`
}

/**
 * Inject file metadata into user prompt at the end
 * @param prompt - The user's message
 * @param files - Array of file metadata
 * @returns Prompt with embedded file metadata
 */
export function injectFilesIntoPrompt(
  prompt: string,
  files: FileMetadata[]
): string {
  if (!files || files.length === 0) return prompt

  const fileLines = files.map(serializeFileLine).join('\n')
  const fileBlock = `\n\n${FILE_METADATA_START}\n${fileLines}\n${FILE_METADATA_END}`

  return prompt + fileBlock
}

/**
 * Extract file metadata from user prompt
 * @param prompt - The prompt potentially containing file metadata
 * @returns Object containing extracted files and clean prompt
 */
export function extractFilesFromPrompt(prompt: string): {
  files: FileMetadata[]
  cleanPrompt: string
} {
  // Prefer the last complete block — inject always appends, and user text may
  // mention the markers earlier (e.g. "what does [/ATTACHED_FILES] mean?").
  const endIndex = prompt.lastIndexOf(FILE_METADATA_END)
  if (endIndex === -1) {
    return { files: [], cleanPrompt: prompt }
  }
  const startIndex = prompt.lastIndexOf(FILE_METADATA_START, endIndex)
  if (startIndex === -1 || endIndex <= startIndex) {
    return { files: [], cleanPrompt: prompt }
  }

  // Extract the file metadata block
  const fileBlock = prompt.substring(
    startIndex + FILE_METADATA_START.length,
    endIndex
  )

  // Parse file metadata (JSON line preferred; legacy key:value still supported)
  const files: FileMetadata[] = []
  const lines = fileBlock.trim().split('\n')
  for (const line of lines) {
    const trimmed = line.replace(/^\s*-\s*/, '').trim()
    if (!trimmed) continue

    const fromJson = trimmed.startsWith('{') ? fileFromJsonLine(trimmed) : null
    const fileObj =
      fromJson ?? fileFromFieldMap(parseMetadataLine(trimmed))
    if (fileObj) files.push(fileObj)
  }

  // Extract clean prompt (everything before [ATTACHED_FILES])
  const cleanPrompt = prompt.substring(0, startIndex).trim()

  return { files, cleanPrompt }
}
