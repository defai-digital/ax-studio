import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Open } from 'unzipper'

/** Restore Unix file permissions from the central directory, without special bits. */
export async function extractZip(
  archive: string,
  outputDirectory: string
): Promise<void> {
  const directory = await Open.file(archive)
  await fsp.mkdir(outputDirectory, { recursive: true })
  const root = await fsp.realpath(outputDirectory)
  const entries = directory.files.map((entry) => {
    const name = entry.path.replaceAll('\\', '/')
    const target = path.resolve(root, name)
    const relative = path.relative(root, target)
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      /^[a-z]:/i.test(name) ||
      name.startsWith('/') ||
      name.includes(':')
    ) {
      throw new Error(`decompress: unsafe ZIP path: ${entry.path}`)
    }
    const unixMode =
      entry.versionMadeBy >>> 8 === 3 ? entry.externalFileAttributes >>> 16 : 0
    const kind = unixMode & 0o170000
    if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) {
      throw new Error(`decompress: unsupported ZIP special file: ${entry.path}`)
    }
    return { entry, target, relative, unixMode }
  })

  for (const { entry, target, relative, unixMode } of entries) {
    // Reject pre-existing symbolic links/junctions before writing or chmodding.
    let current = root
    for (const component of relative.split(path.sep)) {
      current = path.join(current, component)
      const stat = await fsp
        .lstat(current)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null
          throw error
        })
      if (stat?.isSymbolicLink())
        throw new Error(
          `decompress: ZIP path traverses a symbolic link: ${entry.path}`
        )
    }
    if (entry.type === 'Directory') {
      await fsp.mkdir(target, { recursive: true })
      continue
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await pipeline(entry.stream(), fs.createWriteStream(target))
    if (process.platform !== 'win32' && unixMode !== 0) {
      await fsp.chmod(target, unixMode & 0o777)
    }
  }
}
