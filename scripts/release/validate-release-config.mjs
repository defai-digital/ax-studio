#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { WINDOWS_SIGN_COMMAND } from './set-version.mjs'
import {
  CERT_EXPIRY_TIERS,
  applyWindowsCertExpiryPolicy,
} from './windows-cert-expiry.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const stablePlatforms = ['darwin-aarch64', 'windows-x86_64', 'windows-aarch64']
const releaseWorkflowPaths = [
  '.github/workflows/template-tauri-build-macos.yml',
  '.github/workflows/template-tauri-build-windows-x64.yml',
  '.github/workflows/template-tauri-build-windows-arm64.yml',
]
const customNsisTemplatePath = 'src-tauri/tauri.bundle.windows.nsis.template'
const expectedWindowsSignCommand = 'powershell -ExecutionPolicy Bypass -File ./sign.ps1 %1'
const windowsLongPathsCommand = 'git config --global core.longpaths true'
const requiredUpdaterPermissions = [
  'updater:allow-check',
  'updater:allow-download-and-install',
]

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function fail(message) {
  console.error(`release config error: ${message}`)
  process.exitCode = 1
}

function assertArrayEqual(name, actual, expected) {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()

  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${name} must be ${sortedExpected.join(', ')}, got ${sortedActual.join(', ') || '(none)'}`)
  }
}

const tauriConfig = readJson('src-tauri/tauri.conf.json')
const macosConfig = readJson('src-tauri/tauri.macos.conf.json')
const windowsConfig = readJson('src-tauri/tauri.windows.conf.json')
const latestTemplate = readJson('src-tauri/latest.json.template')
const mlxVersion = fs.readFileSync(path.join(repoRoot, 'mlx.version'), 'utf8').trim()

if (tauriConfig.productName !== 'AX Studio') {
  fail(`src-tauri/tauri.conf.json productName must be AX Studio, got ${tauriConfig.productName}`)
}

if (tauriConfig.identifier !== 'ai.axstudio.app') {
  fail(`src-tauri/tauri.conf.json identifier must be ai.axstudio.app, got ${tauriConfig.identifier}`)
}

if (tauriConfig.bundle?.active !== true) {
  fail('src-tauri/tauri.conf.json bundle.active must be true')
}

if (tauriConfig.bundle?.publisher !== 'DEFAI Private Limited') {
  fail('src-tauri/tauri.conf.json bundle.publisher must be DEFAI Private Limited')
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== false) {
  fail('src-tauri/tauri.conf.json should keep bundle.createUpdaterArtifacts false in source; release CI enables it')
}

if (!/^\d+\.\d+\.\d+$/.test(mlxVersion)) {
  fail(`mlx.version must contain a semantic version, got: ${mlxVersion}`)
}

if (macosConfig.bundle?.macOS?.minimumSystemVersion !== '15.0') {
  fail('src-tauri/tauri.macos.conf.json must target macOS 15.0 to match the Homebrew cask')
}

assertArrayEqual(
  'src-tauri/tauri.windows.conf.json bundle.targets',
  windowsConfig.bundle?.targets ?? [],
  ['nsis'],
)
if (windowsConfig.bundle?.windows?.nsis?.installMode !== 'perMachine') {
  fail(
    'src-tauri/tauri.windows.conf.json must set bundle.windows.nsis.installMode to perMachine (matches winget Scope: machine)',
  )
}
// oneClick is not a valid NsisConfig field in tauri-build 2.6.x / CLI 2.8.x;
// perMachine + displayLanguageSelector:false is the supported multi-user setup.

assertArrayEqual(
  'src-tauri/tauri.macos.conf.json bundled MLX libraries',
  macosConfig.bundle?.macOS?.frameworks ?? [],
  [
    'resources/lib/libmlx.dylib',
    'resources/lib/libjaccl.dylib',
  ],
)
if (
  macosConfig.bundle?.macOS?.files?.['Resources/mlx.metallib']
  !== 'resources/lib/mlx.metallib'
) {
  fail('src-tauri/tauri.macos.conf.json must bundle mlx.metallib as a signed app resource')
}

const endpoints = tauriConfig.plugins?.updater?.endpoints
if (!Array.isArray(endpoints) || endpoints.length === 0) {
  fail('src-tauri/tauri.conf.json must configure updater endpoints')
}

const activeCapabilityIds = tauriConfig.app?.security?.capabilities
if (!Array.isArray(activeCapabilityIds) || activeCapabilityIds.length === 0) {
  fail('src-tauri/tauri.conf.json must activate at least one capability')
} else {
  const mainWindowPermissions = new Set()
  for (const capabilityId of activeCapabilityIds) {
    if (typeof capabilityId !== 'string') continue

    const capabilityPath = `src-tauri/capabilities/${capabilityId}.json`
    if (!fs.existsSync(path.join(repoRoot, capabilityPath))) {
      fail(`active capability ${capabilityId} is missing ${capabilityPath}`)
      continue
    }

    const capability = readJson(capabilityPath)
    const windows = capability.windows ?? []
    if (!windows.includes('main') && !windows.includes('*')) continue

    for (const permission of capability.permissions ?? []) {
      const identifier =
        typeof permission === 'string' ? permission : permission?.identifier
      if (identifier) mainWindowPermissions.add(identifier)
    }
  }

  for (const permission of requiredUpdaterPermissions) {
    if (!mainWindowPermissions.has(permission)) {
      fail(`active main-window capabilities must grant ${permission}`)
    }
  }
}

const platforms = Object.keys(latestTemplate.platforms ?? {})
assertArrayEqual('src-tauri/latest.json.template platforms', platforms, stablePlatforms)

for (const platform of stablePlatforms) {
  const entry = latestTemplate.platforms?.[platform]
  if (!entry || typeof entry.signature !== 'string' || typeof entry.url !== 'string') {
    fail(`src-tauri/latest.json.template platform ${platform} must have signature and url string fields`)
  }
}

if (!fs.existsSync(path.join(repoRoot, customNsisTemplatePath))) {
  for (const workflowPath of releaseWorkflowPaths) {
    const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8')
    if (workflow.includes(customNsisTemplatePath)) {
      fail(`${workflowPath} references missing file ${customNsisTemplatePath}`)
    }
  }
}

for (const workflowPath of releaseWorkflowPaths) {
  const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8')
  if (workflow.includes('ctoml') || workflow.includes('cargo-bins/cargo-binstall@main')) {
    fail(`${workflowPath} must not install mutable manifest-editing tools during a release`)
  }
}

for (const workflowPath of releaseWorkflowPaths.filter((workflowPath) => workflowPath.includes('windows'))) {
  const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8')
  if (!workflow.includes(windowsLongPathsCommand)) {
    fail(`${workflowPath} must enable Git long-path support with: ${windowsLongPathsCommand}`)
  }
  if (!workflow.includes('-name "ax-studio.exe"')) {
    fail(`${workflowPath} must recognize the raw Tauri portable binary ax-studio.exe`)
  }
}

const setVersionScript = fs.readFileSync(path.join(repoRoot, 'scripts/release/set-version.mjs'), 'utf8')
const cargoManifest = fs.readFileSync(path.join(repoRoot, 'src-tauri/Cargo.toml'), 'utf8')
if (/['"]devtools['"]/.test(cargoManifest) || /['"]devtools['"]/.test(setVersionScript)) {
  fail('production release configuration must not enable or inject the Tauri devtools feature')
}
if (WINDOWS_SIGN_COMMAND !== expectedWindowsSignCommand) {
  fail(
    `scripts/release/set-version.mjs Windows sign command must be ${expectedWindowsSignCommand}, got ${WINDOWS_SIGN_COMMAND}`,
  )
}

const windowsCertPath = 'docs/release/windows-cert.json'
if (!fs.existsSync(path.join(repoRoot, windowsCertPath))) {
  fail(`${windowsCertPath} is required for Windows Authenticode pin metadata`)
} else {
  const windowsCert = readJson(windowsCertPath)
  const requiredCertFields = [
    'publisher',
    'subjectPattern',
    'thumbprintSha1',
    'notAfter',
    'timestampUrl',
    'productUrl',
    'description',
    'packageIdentifier',
  ]
  for (const field of requiredCertFields) {
    if (typeof windowsCert[field] !== 'string' || !windowsCert[field].trim()) {
      fail(`${windowsCertPath} must define non-empty string field ${field}`)
    }
  }
  if (!/^[0-9A-Fa-f]{40}$/.test(windowsCert.thumbprintSha1)) {
    fail(`${windowsCertPath} thumbprintSha1 must be a 40-character hex SHA-1`)
  }
  if (windowsCert.publisher !== tauriConfig.bundle?.publisher) {
    fail(
      `${windowsCertPath} publisher must match tauri.conf.json bundle.publisher (${tauriConfig.bundle?.publisher})`,
    )
  }
  if (!windowsCert.subjectPattern.includes(windowsCert.publisher)) {
    fail(`${windowsCertPath} subjectPattern must include publisher`)
  }

  const expiry = applyWindowsCertExpiryPolicy(windowsCert.notAfter)
  if (
    expiry.tier === CERT_EXPIRY_TIERS.EXPIRED
    || expiry.tier === CERT_EXPIRY_TIERS.FAIL_SOON
  ) {
    fail(`${windowsCertPath}: ${expiry.message}`)
  }

  const signScript = fs.readFileSync(path.join(repoRoot, 'src-tauri/sign.ps1'), 'utf8')
  if (!signScript.includes('windows-cert.json')) {
    fail('src-tauri/sign.ps1 must load docs/release/windows-cert.json')
  }
  if (!signScript.includes('Get-AuthenticodeSignature')) {
    fail('src-tauri/sign.ps1 must verify Authenticode after signing')
  }

  const verifyScriptPath = 'scripts/release/verify-windows-authenticode.ps1'
  if (!fs.existsSync(path.join(repoRoot, verifyScriptPath))) {
    fail(`${verifyScriptPath} is required for release Authenticode gates`)
  } else {
    const verifyScript = fs.readFileSync(path.join(repoRoot, verifyScriptPath), 'utf8')
    if (!verifyScript.includes('windows-cert.json')) {
      fail(`${verifyScriptPath} must load docs/release/windows-cert.json`)
    }
    if (!verifyScript.includes('RequireVersion')) {
      fail(`${verifyScriptPath} must support RequireVersion for release CI`)
    }
  }

  const releaseWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/ax-studio-tauri-build.yaml'),
    'utf8',
  )
  if (!releaseWorkflow.includes('verify-windows-authenticode.ps1')) {
    fail('release workflow must call scripts/release/verify-windows-authenticode.ps1')
  }
  if (!releaseWorkflow.includes('prepare-windows-distribution.mjs')) {
    fail('release workflow must prepare Windows SHA256SUMS and winget manifests')
  }
  if (!releaseWorkflow.includes('SHA256SUMS-windows.txt')) {
    fail('release workflow must publish SHA256SUMS-windows.txt')
  }
  if (!releaseWorkflow.includes('submit-winget-manifest:')) {
    fail('release workflow must define optional submit-winget-manifest job')
  }
  if (!releaseWorkflow.includes('submit-winget-pr.mjs')) {
    fail('release workflow must call scripts/release/submit-winget-pr.mjs')
  }
  if (!releaseWorkflow.includes('WINGET_PKGS_TOKEN')) {
    fail('release workflow must gate winget submit on WINGET_PKGS_TOKEN')
  }

  const storeWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/ax-studio-microsoft-store-build.yml'),
    'utf8',
  )
  if (!storeWorkflow.includes('verify-windows-authenticode.ps1')) {
    fail('Microsoft Store workflow must call scripts/release/verify-windows-authenticode.ps1')
  }

  const certExpiryWorkflowPath = '.github/workflows/windows-cert-expiry.yml'
  if (!fs.existsSync(path.join(repoRoot, certExpiryWorkflowPath))) {
    fail(`${certExpiryWorkflowPath} is required for scheduled cert expiry checks`)
  } else {
    const certExpiryWorkflow = fs.readFileSync(
      path.join(repoRoot, certExpiryWorkflowPath),
      'utf8',
    )
    if (!certExpiryWorkflow.includes('validate-release-config.mjs')) {
      fail(`${certExpiryWorkflowPath} must run validate-release-config.mjs`)
    }
    if (!certExpiryWorkflow.includes('schedule:')) {
      fail(`${certExpiryWorkflowPath} must run on a schedule`)
    }
  }

  for (const scriptPath of [
    'scripts/release/write-winget-manifest.mjs',
    'scripts/release/prepare-windows-distribution.mjs',
    'scripts/release/submit-winget-pr.mjs',
    'scripts/release/windows-cert-expiry.mjs',
  ]) {
    if (!fs.existsSync(path.join(repoRoot, scriptPath))) {
      fail(`${scriptPath} is required for Windows distribution packaging`)
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`release config ok: stable platforms ${stablePlatforms.join(', ')}`)
