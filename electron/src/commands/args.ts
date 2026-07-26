// Arg unwrapping helpers mirroring the Rust bridge's untagged request enums
// (src-tauri/src/core/filesystem/commands.rs). The web-app sends a mix of
// legacy `{ request: { args: [...] } }` shapes and typed camelCase objects.

type Args = Record<string, unknown>

/** Strip the optional `{ request: ... }` wrapper applied by web-app/src/lib/service.ts. */
export function unwrapRequest(args: Args | undefined): Args {
  if (args && typeof args.request === 'object' && args.request !== null) {
    return args.request as Args
  }
  return args ?? {}
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** SinglePathRequest: { args: [path] } | { path }. */
export function singlePath(args: Args | undefined, command: string): string {
  const req = unwrapRequest(args)
  if (Array.isArray(req.args)) {
    const first = req.args.find((v) => typeof v === 'string' && v.length > 0)
    if (typeof first === 'string') return first
  }
  const p = str(req.path)
  if (p) return p
  throw new Error(`${command} error: Invalid argument`)
}

/** PathPairRequest: { args: [source, destination] } | { source, destination }. */
export function pathPair(args: Args | undefined, command: string): [string, string] {
  const req = unwrapRequest(args)
  if (Array.isArray(req.args)) {
    const [a, b] = req.args
    if (str(a) && str(b)) return [a as string, b as string]
  }
  const source = str(req.source)
  const destination = str(req.destination)
  if (source && destination) return [source, destination]
  throw new Error(`${command} error: Invalid argument - source and destination required`)
}

/** FileContentRequest: { args: [path, content] } | { path, data } | { path, content }. */
export function fileContent(args: Args | undefined, command: string): [string, string] {
  const req = unwrapRequest(args)
  if (Array.isArray(req.args)) {
    const [a, b] = req.args
    if (str(a) && typeof b === 'string') return [a as string, b]
  }
  const p = str(req.path)
  const content = typeof req.data === 'string' ? req.data : req.content
  if (p && typeof content === 'string') return [p, content]
  throw new Error(`${command} error: Invalid argument - path and content required`)
}

/** JoinPathRequest: { args: [...] } | { basePath | base_path, parts? }. */
export function joinPathParts(args: Args | undefined): string[] {
  const req = unwrapRequest(args)
  if (Array.isArray(req.args) && req.args.every((v) => typeof v === 'string')) {
    if (req.args.length > 0) return req.args as string[]
  }
  const base = str(req.basePath) ?? str(req.base_path)
  if (base) {
    const parts = Array.isArray(req.parts) ? req.parts.filter((v): v is string => typeof v === 'string') : []
    return [base, ...parts]
  }
  throw new Error('join_path error: Invalid argument')
}

/** GgufFilesRequest: { args: [...] } | { paths: [...] }. */
export function stringList(args: Args | undefined, command: string): string[] {
  const req = unwrapRequest(args)
  const list = Array.isArray(req.args) ? req.args : Array.isArray(req.paths) ? req.paths : null
  if (list && list.length > 0 && list.every((v) => typeof v === 'string' && v.length > 0)) {
    return list as string[]
  }
  throw new Error(`${command} error: Invalid argument`)
}

/** LogRequest: { args: [message, fileName?] } | { message, fileName? | file_name? }. */
export function logParts(args: Args | undefined): [string, string | undefined] {
  const req = unwrapRequest(args)
  if (Array.isArray(req.args)) {
    const [message, fileName] = req.args
    if (str(message)) return [message as string, str(fileName)]
  }
  const message = str(req.message)
  if (message) return [message, str(req.fileName) ?? str(req.file_name)]
  throw new Error('log error: Invalid argument')
}

/** WriteYamlRequest: { data, savePath | save_path } | { data, path }. */
export function writeYamlParts(args: Args | undefined): [string, string] {
  const req = unwrapRequest(args)
  const data = typeof req.data === 'string' ? req.data : undefined
  const target = str(req.path) ?? str(req.savePath) ?? str(req.save_path)
  if (data !== undefined && target) return [data, target]
  throw new Error('write_yaml error: Invalid argument')
}
