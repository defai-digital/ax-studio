import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

const MARKER = '.ax-studio-data.json'
const MANAGED = new Set([
  'threads',
  'llamacpp',
  'ax-engine',
  'ax-serving',
  'app.log',
  MARKER,
])

async function digest(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function inventory(root: string, relative = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const name = path.join(relative, entry.name)
    const stat = await fs.lstat(path.join(root, name))
    // Do not follow junctions/symlinks outside the selected data directory.
    if (stat.isSymbolicLink())
      throw new Error(
        'Data migration does not support symbolic links or junctions'
      )
    if (stat.isDirectory())
      result.push(`D:${name}`, ...(await inventory(root, name)))
    else if (stat.isFile())
      result.push(
        `F:${name}:${stat.size}:${await digest(path.join(root, name))}`
      )
    else throw new Error('Unsupported file in data directory')
  }
  return result.sort()
}

export async function migrateDataDirectory(
  source: string,
  destination: string,
  commit: () => void
): Promise<void> {
  const from = await fs.realpath(source)
  await fs.mkdir(path.resolve(destination), { recursive: true })
  if ((await fs.lstat(destination)).isSymbolicLink()) {
    throw new Error(
      'Data migration does not support symbolic links or junctions'
    )
  }
  const to = await fs.realpath(destination)
  if (path.relative(from, to) === '') return
  for (const [parent, child] of [
    [from, to],
    [to, from],
  ]) {
    const relative = path.relative(parent, child)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      throw new Error(
        'Source and destination data directories must not contain each other'
      )
    }
  }
  if ((await fs.readdir(to)).length)
    throw new Error('Choose an empty destination folder for data migration')
  const before = await inventory(from)
  // Retain the source as a recovery copy, including on copy/verification failure.
  // A failed destination is deliberately retained for inspection, never blindly deleted.
  for (const entry of await fs.readdir(from)) {
    await fs.cp(path.join(from, entry), path.join(to, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    })
  }
  const copied = await inventory(to)
  const after = await inventory(from)
  if (
    JSON.stringify(before) !== JSON.stringify(copied) ||
    JSON.stringify(before) !== JSON.stringify(after)
  ) {
    throw new Error(
      'Data changed or failed verification during migration; original folder remains active'
    )
  }
  await fs.writeFile(
    path.join(to, MARKER),
    JSON.stringify({ application: 'ax-studio', version: 1 })
  )
  commit()
}

export async function resetManagedData(
  directory: string,
  defaultDirectory: string
): Promise<void> {
  const root = await fs.realpath(directory)
  const marker = await fs
    .readFile(path.join(root, MARKER), 'utf8')
    .catch(() => '')
  let owned = false
  try {
    owned = JSON.parse(marker).application === 'ax-studio'
  } catch {
    /* legacy folder */
  }
  // Only the legacy default directory or a verified migration target is owned.
  if (!owned && path.relative(root, path.resolve(defaultDirectory)) !== '') {
    throw new Error(
      'Reset refused: this is not an AX Studio-owned data folder. Migrate to an empty dedicated folder first.'
    )
  }
  const entries = await fs.readdir(root)
  // Preserve all unrelated entries. Refuse symlinked managed roots before deleting anything.
  const targets = entries.filter((name) => MANAGED.has(name) && name !== MARKER)
  for (const name of targets) {
    if ((await fs.lstat(path.join(root, name))).isSymbolicLink()) {
      throw new Error(
        'Reset refused: managed data contains a symbolic link or junction'
      )
    }
    await inventoryEntry(path.join(root, name))
  }
  for (const name of targets)
    await fs.rm(path.join(root, name), { recursive: true, force: true })
}

async function inventoryEntry(target: string): Promise<void> {
  const stat = await fs.lstat(target)
  if (stat.isSymbolicLink())
    throw new Error(
      'Reset refused: managed data contains a symbolic link or junction'
    )
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(target))
      await inventoryEntry(path.join(target, entry))
  }
}
