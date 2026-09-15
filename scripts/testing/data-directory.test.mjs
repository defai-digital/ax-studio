import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  migrateDataDirectory,
  resetManagedData,
} from '../../electron/src/data-directory.ts'

const roots = []
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ax-data-test-'))
  roots.push(root)
  const source = path.join(root, 'source'),
    target = path.join(root, 'target')
  await fs.mkdir(path.join(source, 'threads'), { recursive: true })
  await fs.writeFile(
    path.join(source, 'threads', 'message.json'),
    '{"text":"hello"}'
  )
  return { root, source, target }
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true })
})
describe('data directory lifecycle', () => {
  it('verifies a full copy before committing and retains the recovery source', async () => {
    const { source, target } = await fixture()
    const commit = vi.fn(() => expect(true).toBe(true))
    await migrateDataDirectory(source, target, commit)
    expect(
      await fs.readFile(path.join(target, 'threads', 'message.json'), 'utf8')
    ).toBe('{"text":"hello"}')
    expect(
      await fs.readFile(path.join(source, 'threads', 'message.json'), 'utf8')
    ).toContain('hello')
    expect(commit).toHaveBeenCalledOnce()
  })
  it('rejects nonempty and nested targets without changing configuration', async () => {
    const { source, target } = await fixture()
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'personal.txt'), 'keep')
    const commit = vi.fn()
    await expect(migrateDataDirectory(source, target, commit)).rejects.toThrow(
      'empty'
    )
    await expect(
      migrateDataDirectory(source, path.join(source, 'nested'), commit)
    ).rejects.toThrow('contain')
    expect(commit).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(target, 'personal.txt'), 'utf8')).toBe(
      'keep'
    )
  })
  it('rejects a destination junction without copying into its target', async () => {
    const { root, source, target } = await fixture()
    const external = path.join(root, 'external')
    await fs.mkdir(external)
    await fs.symlink(external, target, 'junction')
    await expect(migrateDataDirectory(source, target, vi.fn())).rejects.toThrow(
      'symbolic links'
    )
    expect(await fs.readdir(external)).toEqual([])
  })

  it('preserves originals if configuration commit fails', async () => {
    const { source, target } = await fixture()
    await expect(
      migrateDataDirectory(source, target, () => {
        throw new Error('disk full')
      })
    ).rejects.toThrow('disk full')
    expect(
      await fs.readFile(path.join(source, 'threads', 'message.json'), 'utf8')
    ).toContain('hello')
  })
  it('refuses reset of an arbitrary custom folder, even if it has a threads directory', async () => {
    const { source, target } = await fixture()
    await expect(resetManagedData(source, target)).rejects.toThrow(
      'not an AX Studio-owned'
    )
    expect(
      await fs.readFile(path.join(source, 'threads', 'message.json'), 'utf8')
    ).toContain('hello')
  })
  it('resets only managed entries and preserves unrelated files in a verified target', async () => {
    const { source, target } = await fixture()
    await migrateDataDirectory(source, target, () => {})
    await fs.writeFile(path.join(target, 'personal.txt'), 'keep')
    await resetManagedData(target, source)
    expect(await fs.readFile(path.join(target, 'personal.txt'), 'utf8')).toBe(
      'keep'
    )
    await expect(fs.stat(path.join(target, 'threads'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('rejects junctions during migration and reset without touching their targets', async () => {
    const { root, source, target } = await fixture()
    const external = path.join(root, 'external')
    await fs.mkdir(external)
    await fs.writeFile(path.join(external, 'personal.txt'), 'keep')
    await fs.symlink(
      external,
      path.join(source, 'threads', 'linked'),
      'junction'
    )
    await expect(migrateDataDirectory(source, target, vi.fn())).rejects.toThrow(
      'symbolic links'
    )
    await expect(resetManagedData(source, source)).rejects.toThrow(
      'symbolic link'
    )
    expect(await fs.readFile(path.join(external, 'personal.txt'), 'utf8')).toBe(
      'keep'
    )
  })
})
