import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowsDirectory = path.join(repoRoot, '.github', 'workflows')
const requiredFirstPartyActions = new Map([
  ['actions/checkout', 'v7'],
  ['actions/setup-node', 'v6'],
  ['actions/setup-go', 'v6'],
  ['actions/upload-artifact', 'v7'],
  ['actions/download-artifact', 'v8'],
])

function readWorkflows() {
  return fs.readdirSync(workflowsDirectory)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .sort()
    .map((fileName) => ({
      fileName,
      content: fs.readFileSync(path.join(workflowsDirectory, fileName), 'utf8'),
    }))
}

describe('GitHub Actions dependency boundaries', () => {
  it('uses the supported Node 24 majors for first-party actions', () => {
    const observedActions = new Map(
      [...requiredFirstPartyActions.keys()].map((action) => [action, []]),
    )

    for (const workflow of readWorkflows()) {
      for (const match of workflow.content.matchAll(/uses:\s+(actions\/[\w-]+)@([^\s#]+)/g)) {
        const [, action, version] = match
        if (observedActions.has(action)) {
          observedActions.get(action).push({ fileName: workflow.fileName, version })
        }
      }
    }

    for (const [action, expectedVersion] of requiredFirstPartyActions) {
      const uses = observedActions.get(action)
      expect(uses.length, `${action} should remain covered by this policy`).toBeGreaterThan(0)
      expect(
        uses.filter(({ version }) => version !== expectedVersion),
        `${action} must use ${expectedVersion}`,
      ).toEqual([])
    }
  })

  it('requires Windows Authenticode credentials and validates them before building', () => {
    const windowsWorkflows = readWorkflows()
      .filter(({ fileName }) => fileName.includes('build-windows'))

    expect(windowsWorkflows.length).toBe(2)

    const signingSecrets = [
      'AZURE_KEY_VAULT_URI',
      'AZURE_CLIENT_ID',
      'AZURE_TENANT_ID',
      'AZURE_CLIENT_SECRET',
      'AZURE_CERT_NAME',
    ]

    for (const workflow of windowsWorkflows) {
      for (const secret of signingSecrets) {
        expect(workflow.content).toMatch(
          new RegExp(`${secret}:\\r?\\n\\s+required: true`),
        )
      }
      expect(workflow.content).toContain('Validate Windows signing configuration')
      expect(workflow.content.indexOf('Validate Windows signing configuration'))
        .toBeLessThan(workflow.content.indexOf('- name: Build app'))
    }
  })

  it('keeps Windows signing fail-closed and verifies the expected certificate', () => {
    const signScript = fs.readFileSync(path.join(repoRoot, 'src-tauri', 'sign.ps1'), 'utf8')

    expect(signScript).not.toContain('Skipping Windows code signing')
    expect(signScript).toContain('-fd sha256')
    expect(signScript).toContain('-td sha256')
    expect(signScript).toContain('Get-AuthenticodeSignature')
    expect(signScript).toContain('FC40F1109912C025E751E804AA9BD1538A2D12EF')
    expect(signScript).toContain('$LASTEXITCODE')
  })

  it('independently verifies uploaded Apple, Authenticode, and Minisign signatures', () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-tauri-build.yaml'),
      'utf8',
    )

    expect(releaseWorkflow).toContain('verify-macos-release-signature:')
    expect(releaseWorkflow).toContain('xcrun stapler validate')
    expect(releaseWorkflow).toContain('Authority=Developer ID Application: DEFAI PRIVATE LIMITED')
    expect(releaseWorkflow).toContain('verify-windows-authenticode:')
    expect(releaseWorkflow).toContain('Get-AuthenticodeSignature')
    expect(releaseWorkflow).toContain('FC40F1109912C025E751E804AA9BD1538A2D12EF')
    expect(releaseWorkflow).toContain('--verify-only')
    expect(releaseWorkflow).toContain('docs/ax-studio.minisign.pub')
  })

  it('requires and verifies the Homebrew stable release path', () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-tauri-build.yaml'),
      'utf8',
    )
    const caskWriter = fs.readFileSync(
      path.join(repoRoot, 'scripts', 'release', 'write-homebrew-cask.mjs'),
      'utf8',
    )

    expect(releaseWorkflow).toContain('Stable releases require HOMEBREW_TAP_TOKEN or TAP_TOKEN.')
    expect(releaseWorkflow).toContain('verify-homebrew-install:')
    expect(releaseWorkflow).toContain('brew audit --cask --strict')
    expect(releaseWorkflow).toContain('brew install --cask defai-digital/ax-studio/ax-studio')
    expect(releaseWorkflow).toContain('spctl --assess --type execute')
    expect(caskWriter).not.toContain('xattr')
  })

  it('does not execute actions from mutable branch refs', () => {
    const mutableReferences = []

    for (const workflow of readWorkflows()) {
      for (const match of workflow.content.matchAll(/uses:\s+([^\s#]+@(main|master|HEAD))\b/g)) {
        mutableReferences.push(`${workflow.fileName}: ${match[1]}`)
      }
    }

    expect(mutableReferences).toEqual([])
  })
})
