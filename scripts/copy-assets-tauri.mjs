import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const preInstallSource = join(repoRoot, 'pre-install')
const resourcesDir = join(repoRoot, 'src-tauri', 'resources')
const preInstallDest = join(resourcesDir, 'pre-install')

await mkdir(preInstallDest, { recursive: true })

for (const entry of await readdir(preInstallDest).catch(() => [])) {
  if (entry.endsWith('.tgz')) {
    await rm(join(preInstallDest, entry), { force: true })
  }
}

for (const entry of await readdir(preInstallSource).catch(() => [])) {
  if (entry.endsWith('.tgz')) {
    await cp(join(preInstallSource, entry), join(preInstallDest, entry))
  }
}

await cp(join(repoRoot, 'LICENSE'), join(resourcesDir, 'LICENSE'))
await cp(join(repoRoot, 'NOTICE'), join(resourcesDir, 'NOTICE'))
