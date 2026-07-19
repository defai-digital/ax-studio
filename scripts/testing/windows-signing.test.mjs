import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CERT_EXPIRY_TIERS,
  evaluateWindowsCertExpiry,
} from '../release/windows-cert-expiry.mjs'
import { wingetPackageRelativeDir } from '../release/write-winget-manifest.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('Windows signing and packaging practice', () => {
  it('publishes NSIS-only with perMachine install mode', () => {
    const windowsConfig = JSON.parse(read('src-tauri/tauri.windows.conf.json'))
    expect(windowsConfig.bundle.targets).toEqual(['nsis'])
    expect(windowsConfig.bundle.windows.nsis.installMode).toBe('perMachine')
    expect(windowsConfig.bundle.windows.nsis.oneClick).toBe(false)
  })

  it('evaluates cert expiry tiers with an injectable clock', () => {
    const now = Date.parse('2026-07-19T00:00:00Z')
    const day = 24 * 60 * 60 * 1000

    expect(evaluateWindowsCertExpiry(new Date(now + 120 * day).toISOString(), now).tier).toBe(
      CERT_EXPIRY_TIERS.OK,
    )
    expect(evaluateWindowsCertExpiry(new Date(now + 75 * day).toISOString(), now).tier).toBe(
      CERT_EXPIRY_TIERS.NOTICE,
    )
    expect(evaluateWindowsCertExpiry(new Date(now + 45 * day).toISOString(), now).tier).toBe(
      CERT_EXPIRY_TIERS.WARN,
    )
    expect(evaluateWindowsCertExpiry(new Date(now + 10 * day).toISOString(), now).tier).toBe(
      CERT_EXPIRY_TIERS.FAIL_SOON,
    )
    expect(evaluateWindowsCertExpiry(new Date(now - day).toISOString(), now).tier).toBe(
      CERT_EXPIRY_TIERS.EXPIRED,
    )
  })

  it('derives winget package directory from packageIdentifier', () => {
    // First letter of publisher segment (DEFAI → d), not a hardcoded "m".
    expect(wingetPackageRelativeDir('DEFAI.AXStudio')).toBe(
      path.join('d', 'DEFAI', 'AXStudio'),
    )
    expect(wingetPackageRelativeDir('Microsoft.VisualStudioCode')).toBe(
      path.join('m', 'Microsoft', 'VisualStudioCode'),
    )
  })

  it('dry-runs winget submit against generated manifests', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-winget-submit-'))
    const version = '2.2.0'
    const gen = spawnSync(
      process.execPath,
      [
        'scripts/release/write-winget-manifest.mjs',
        '--version',
        version,
        '--x64-sha256',
        'a'.repeat(64),
        '--arm64-sha256',
        'b'.repeat(64),
        '--out-dir',
        outDir,
        '--release-date',
        '2026-07-19',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    )
    expect(gen.status, gen.stderr || gen.stdout).toBe(0)

    const result = spawnSync(
      process.execPath,
      [
        'scripts/release/submit-winget-pr.mjs',
        '--version',
        version,
        '--manifests-dir',
        outDir,
        '--dry-run',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, WINGET_SUBMIT_SKIP_DOWNLOAD: '1' },
      },
    )
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toContain('[dry-run]')
    expect(result.stdout).toContain('DEFAI.AXStudio')
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  it('keeps public cert metadata complete and aligned with the app publisher', () => {
    const cert = JSON.parse(read('docs/release/windows-cert.json'))
    const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))

    expect(cert.publisher).toBe('DEFAI Private Limited')
    expect(cert.publisher).toBe(tauriConfig.bundle.publisher)
    expect(cert.subjectPattern).toContain(cert.publisher)
    expect(cert.thumbprintSha1).toMatch(/^[0-9A-Fa-f]{40}$/)
    expect(cert.packageIdentifier).toBe('DEFAI.AXStudio')
    expect(cert.timestampUrl).toMatch(/^https?:\/\/.+/)
    expect(Date.parse(cert.notAfter)).toBeGreaterThan(Date.now())
    expect(read('docs/release/windows-signing.md')).toContain('windows-cert.json')
    expect(read('docs/release/windows-signing.md')).toContain('verify-windows-authenticode.ps1')
  })

  it('loads cert metadata from sign.ps1 and the shared verify script', () => {
    const signScript = read('src-tauri/sign.ps1')
    const verifyScript = read('scripts/release/verify-windows-authenticode.ps1')
    const storeSmoke = read('scripts/release/test-microsoft-store-installer.ps1')

    expect(signScript).toContain('windows-cert.json')
    expect(signScript).toContain('AzureSignTool')
    expect(signScript).not.toContain('Skipping Windows code signing')
    expect(verifyScript).toContain('windows-cert.json')
    expect(verifyScript).toContain('RequireVersion')
    expect(verifyScript).toContain('TimeStamperCertificate')
    expect(verifyScript).toContain('SignerCertificate.NotAfter')
    expect(storeSmoke).toContain('windows-cert.json')
    expect(storeSmoke).toContain('RequirePinnedThumbprint')
  })

  it('writes winget manifests for both Windows architectures', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-winget-'))
    const x64Sha = 'a'.repeat(64)
    const arm64Sha = 'b'.repeat(64)
    const version = '2.2.0'

    const result = spawnSync(
      process.execPath,
      [
        'scripts/release/write-winget-manifest.mjs',
        '--version',
        version,
        '--x64-sha256',
        x64Sha,
        '--arm64-sha256',
        arm64Sha,
        '--out-dir',
        outDir,
        '--release-date',
        '2026-07-19',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )

    expect(result.status, result.stderr || result.stdout).toBe(0)

    const versionDir = path.join(outDir, 'd', 'DEFAI', 'AXStudio', version)
    const installer = fs.readFileSync(
      path.join(versionDir, 'DEFAI.AXStudio.installer.yaml'),
      'utf8',
    )
    const locale = fs.readFileSync(
      path.join(versionDir, 'DEFAI.AXStudio.locale.en-US.yaml'),
      'utf8',
    )
    const versionManifest = fs.readFileSync(
      path.join(versionDir, 'DEFAI.AXStudio.yaml'),
      'utf8',
    )

    expect(versionManifest).toContain('PackageIdentifier: DEFAI.AXStudio')
    expect(installer).toContain(`AX.Studio_${version}_x64-setup.exe`)
    expect(installer).toContain(`AX.Studio_${version}_arm64-setup.exe`)
    expect(installer).toContain(x64Sha.toUpperCase())
    expect(installer).toContain(arm64Sha.toUpperCase())
    expect(installer).toContain('InstallerType: nullsoft')
    expect(installer).toContain('ReleaseDate: 2026-07-19')
    expect(locale).toContain('Publisher: DEFAI Private Limited')
    expect(locale).toContain('Moniker: ax-studio')

    fs.rmSync(outDir, { recursive: true, force: true })
  })

  it('prepares Windows SHA256SUMS and winget output from setup EXEs', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-win-dist-'))
    const artifactsDir = path.join(workDir, 'artifacts')
    const outDir = path.join(workDir, 'out')
    fs.mkdirSync(artifactsDir)
    const version = '2.2.0'
    const x64Name = `AX.Studio_${version}_x64-setup.exe`
    const arm64Name = `AX.Studio_${version}_arm64-setup.exe`
    fs.writeFileSync(path.join(artifactsDir, x64Name), 'x64-installer-bytes')
    fs.writeFileSync(path.join(artifactsDir, arm64Name), 'arm64-installer-bytes')

    const result = spawnSync(
      process.execPath,
      [
        'scripts/release/prepare-windows-distribution.mjs',
        '--version',
        version,
        '--artifacts-dir',
        artifactsDir,
        '--out-dir',
        outDir,
        '--release-date',
        '2026-07-19',
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    )

    expect(result.status, result.stderr || result.stdout).toBe(0)
    const sums = fs.readFileSync(path.join(outDir, 'SHA256SUMS-windows.txt'), 'utf8')
    expect(sums).toContain(x64Name)
    expect(sums).toContain(arm64Name)
    expect(sums.trim().split('\n')).toHaveLength(2)

    const summary = JSON.parse(
      fs.readFileSync(path.join(outDir, 'windows-distribution.json'), 'utf8'),
    )
    expect(summary.version).toBe(version)
    expect(summary.packageIdentifier).toBe('DEFAI.AXStudio')
    expect(summary.installers).toHaveLength(2)

    const wingetInstaller = fs.readFileSync(
      path.join(outDir, 'winget', 'd', 'DEFAI', 'AXStudio', version, 'DEFAI.AXStudio.installer.yaml'),
      'utf8',
    )
    expect(wingetInstaller).toContain(summary.installers[0].sha256.toUpperCase())

    fs.rmSync(workDir, { recursive: true, force: true })
  })
})
