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
    const certMetadata = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'docs', 'release', 'windows-cert.json'), 'utf8'),
    )

    expect(signScript).not.toContain('Skipping Windows code signing')
    expect(signScript).toContain('-fd sha256')
    expect(signScript).toContain('-td sha256')
    expect(signScript).toContain('Get-AuthenticodeSignature')
    expect(signScript).toContain('windows-cert.json')
    expect(signScript).toContain('$LASTEXITCODE')
    expect(certMetadata.thumbprintSha1).toMatch(/^[0-9A-Fa-f]{40}$/)
  })

  it('independently verifies uploaded Apple, Authenticode, and Minisign signatures', () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-tauri-build.yaml'),
      'utf8',
    )
    const verifyScript = fs.readFileSync(
      path.join(repoRoot, 'scripts', 'release', 'verify-windows-authenticode.ps1'),
      'utf8',
    )

    expect(releaseWorkflow).toContain('verify-macos-release-signature:')
    expect(releaseWorkflow).toContain('xcrun stapler validate')
    expect(releaseWorkflow).toContain('Authority=Developer ID Application: DEFAI PRIVATE LIMITED')
    expect(releaseWorkflow).toContain('Contents/Frameworks/libmlx.dylib')
    expect(releaseWorkflow).toContain('Contents/Frameworks/libjaccl.dylib')
    expect(releaseWorkflow).toContain('Contents/Resources/mlx.metallib')
    expect(releaseWorkflow).toContain('Contents/MacOS/ax-studio')
    expect(releaseWorkflow).not.toContain('Contents/MacOS/AX Studio')
    expect(releaseWorkflow).toContain('@executable_path/../Frameworks')
    expect(releaseWorkflow).toContain('LSMinimumSystemVersion')
    expect(releaseWorkflow).toContain('vtool -show-build "$MLX_LIBRARY"')
    expect(releaseWorkflow).toContain("grep -E '^Timestamp='")
    expect(releaseWorkflow).toContain('verify-windows-authenticode:')
    expect(releaseWorkflow).toContain('verify-windows-authenticode.ps1')
    expect(releaseWorkflow).toContain('-RequireVersion')
    expect(releaseWorkflow).toContain('prepare-windows-distribution:')
    expect(releaseWorkflow).toContain('prepare-windows-distribution.mjs')
    expect(releaseWorkflow).toContain('SHA256SUMS-windows.txt')
    expect(releaseWorkflow).toContain('ax-studio-winget-manifests-')
    expect(verifyScript).toContain('Get-AuthenticodeSignature')
    expect(verifyScript).toContain('windows-cert.json')
    expect(releaseWorkflow).toContain('--verify-only')
    expect(releaseWorkflow).toContain('docs/release/ax-minisign.pub')
    expect(releaseWorkflow).toContain('artifacts/ax-minisign.pub')
    expect(releaseWorkflow).toContain('cmp docs/release/ax-minisign.pub artifacts/ax-minisign.pub')
    expect(releaseWorkflow).toContain('signkey/ax.minisign.key')
    expect(releaseWorkflow).toContain('signkey/ax.pub')
    expect(releaseWorkflow).not.toContain('signkey/ax-studio.minisign.key')
    expect(releaseWorkflow).not.toContain('signkey/ax-studio.minisign.pub')
  })

  it('builds macOS against the pinned, bundled MLX wheel', () => {
    const macBuildWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'template-tauri-build-macos.yml'),
      'utf8',
    )
    const testWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-linter-and-test.yml'),
      'utf8',
    )
    const macConfig = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.macos.conf.json'), 'utf8'),
    )

    for (const workflow of [macBuildWorkflow, testWorkflow]) {
      expect(workflow).toContain('PYO3_PYTHON="$MLX_VENV/bin/python"')
      expect(workflow).toContain('scripts/prepare-mlx-runtime.mjs')
      expect(workflow).toContain('VIRTUAL_ENV=$MLX_VENV')
      expect(workflow).not.toContain('brew install mlx')
    }
    expect(macConfig.bundle.macOS.frameworks).toEqual([
      'resources/lib/libmlx.dylib',
      'resources/lib/libjaccl.dylib',
    ])
    expect(macConfig.bundle.macOS.minimumSystemVersion).toBe('15.0')
    expect(macConfig.bundle.macOS.files).toEqual({
      'Resources/mlx.metallib': 'resources/lib/mlx.metallib',
    })
  })

  it('refuses to mutate a published release', () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-tauri-build.yaml'),
      'utf8',
    )

    expect(releaseWorkflow).toContain(
      'Release $TAG is already published; refusing to replace verified assets.',
    )
    expect(releaseWorkflow).toContain(
      'Release $TAG is no longer a draft; refusing to publish or mutate it.',
    )
    expect(releaseWorkflow).not.toContain('continuing to replace assets in place')
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
    expect(releaseWorkflow).toContain('release.dmg.minisig')
    expect(releaseWorkflow).toContain('minisign -V -p docs/release/ax-minisign.pub')
    expect(caskWriter).not.toContain('xattr')
    expect(caskWriter).not.toContain('brew install mlx')
    expect(caskWriter).toContain('auto_updates false')
    expect(caskWriter).toContain('brew upgrade --cask ax-studio')
  })

  it('optionally submits winget manifests after publish', () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-tauri-build.yaml'),
      'utf8',
    )
    expect(releaseWorkflow).toContain('submit-winget-manifest:')
    expect(releaseWorkflow).toContain('submit-winget-pr.mjs')
    expect(releaseWorkflow).toContain('WINGET_PKGS_TOKEN')
    expect(releaseWorkflow).toContain('publish-release')
  })

  it('runs a scheduled Windows cert expiry workflow', () => {
    const expiryWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'windows-cert-expiry.yml'),
      'utf8',
    )
    expect(expiryWorkflow).toContain('validate-release-config.mjs')
    expect(expiryWorkflow).toContain('schedule:')
  })

  it('keeps release downloads authenticated, observable, and retryable', () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'ax-studio-tauri-build.yaml'),
      'utf8',
    )
    const versionWorkflow = fs.readFileSync(
      path.join(workflowsDirectory, 'template-get-update-version.yml'),
      'utf8',
    )

    expect(releaseWorkflow).toContain('gh release download')
    expect(releaseWorkflow).toContain('curl --fail --location --no-progress-meter')
    expect(releaseWorkflow).toContain('--retry 6 --retry-all-errors --retry-delay 10')
    expect(releaseWorkflow).toContain('--connect-timeout 15 --max-time 600 --remove-on-error')
    expect(releaseWorkflow).toContain("--proto '=https' --proto-redir '=https'")
    expect(releaseWorkflow).not.toContain('curl -fsSL')

    expect(versionWorkflow).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
    expect(versionWorkflow).toContain('gh api')
    expect(versionWorkflow).toContain('repos/${GITHUB_REPOSITORY}/releases/latest')
    expect(versionWorkflow).toContain("--jq '.tag_name'")
    expect(versionWorkflow).not.toContain('curl -H "Authorization: token')
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
