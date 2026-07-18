import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function packageEnginesNode(relativePath) {
  const pkg = JSON.parse(read(relativePath))
  return pkg.engines?.node
}

describe('toolchain version pins', () => {
  it('pins Node.js 24 as the project baseline', () => {
    expect(read('.nvmrc').trim()).toBe('24')
    expect(packageEnginesNode('package.json')).toBe('^24.0.0')
    expect(packageEnginesNode('web-app/package.json')).toBe('^24.0.0')

    const workflowsDir = path.join(repoRoot, '.github', 'workflows')
    const workflowFiles = fs
      .readdirSync(workflowsDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))

    const nodeVersions = []
    for (const fileName of workflowFiles) {
      const content = fs.readFileSync(path.join(workflowsDir, fileName), 'utf8')
      for (const match of content.matchAll(/node-version:\s*['"]?([^\s'"]+)/g)) {
        nodeVersions.push({ fileName, version: match[1] })
      }
    }

    expect(nodeVersions.length, 'CI should declare at least one node-version').toBeGreaterThan(0)
    expect(
      nodeVersions.filter(({ version }) => version !== '24' && !version.startsWith('24.')),
      'every CI node-version must target Node 24',
    ).toEqual([])
  })

  it('pins Rust MSRV to 1.85.0 across src-tauri manifests', () => {
    const cargoTomls = [
      'src-tauri/Cargo.toml',
      'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
      'src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml',
    ]

    for (const relativePath of cargoTomls) {
      const content = read(relativePath)
      const match = content.match(/^rust-version\s*=\s*"([^"]+)"/m)
      expect(match, `${relativePath} must declare rust-version`).not.toBeNull()
      expect(match[1], `${relativePath} rust-version`).toBe('1.85.0')
    }
  })
})
