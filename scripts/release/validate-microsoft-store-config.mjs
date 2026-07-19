#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const storeConfigPath = 'src-tauri/tauri.microsoftstore.conf.json'
const storeWorkflowPath = '.github/workflows/ax-studio-microsoft-store-build.yml'
const windowsWorkflowPaths = [
  '.github/workflows/template-tauri-build-windows-x64.yml',
  '.github/workflows/template-tauri-build-windows-arm64.yml',
]
const requiredDocuments = [
  'docs/legal/privacy.md',
  'docs/legal/terms.md',
  'docs/release/microsoft-store.md',
  '.github/ISSUE_TEMPLATE/ai-content-report.yml',
]

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function fail(message) {
  console.error(`microsoft store config error: ${message}`)
  process.exitCode = 1
}

const baseConfig = readJson('src-tauri/tauri.conf.json')
const windowsConfig = readJson('src-tauri/tauri.windows.conf.json')
const storeConfig = readJson(storeConfigPath)

if (baseConfig.bundle?.publisher !== 'DEFAI Private Limited') {
  fail('the Windows publisher must be DEFAI Private Limited')
}

if (JSON.stringify(storeConfig.bundle?.targets) !== JSON.stringify(['nsis'])) {
  fail(`${storeConfigPath} must build only the NSIS installer`)
}

if (storeConfig.bundle?.windows?.webviewInstallMode?.type !== 'offlineInstaller') {
  fail(`${storeConfigPath} must use the offlineInstaller WebView2 mode`)
}

const externalBins = windowsConfig.bundle?.externalBin ?? []
for (const binary of ['resources/bin/bun', 'resources/bin/uv']) {
  if (!externalBins.includes(binary)) {
    fail(`Windows bundles must include and sign ${binary}`)
  }
}

for (const relativePath of requiredDocuments) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(`required Store document is missing: ${relativePath}`)
  }
}

const workflow = read(storeWorkflowPath)
for (const requiredText of [
  'microsoft_store: true',
  'validate-microsoft-store-config.mjs',
  'test-microsoft-store-installer.ps1',
  'AX.Studio_${VERSION}_x64-store-setup.exe',
  'AX.Studio_${VERSION}_arm64-store-setup.exe',
]) {
  if (!workflow.includes(requiredText)) {
    fail(`${storeWorkflowPath} must include ${requiredText}`)
  }
}
if (workflow.includes('--clobber')) {
  fail(`${storeWorkflowPath} must never overwrite a submitted Store artifact`)
}

for (const workflowPath of windowsWorkflowPaths) {
  const windowsWorkflow = read(workflowPath)
  for (const requiredText of [
    'microsoft_store:',
    'TAURI_BUILD_CONFIG:',
    storeConfigPath,
    'if-no-files-found: error',
  ]) {
    if (!windowsWorkflow.includes(requiredText)) {
      fail(`${workflowPath} must include ${requiredText}`)
    }
  }
}

const linksSource = read('web-app/src/constants/external-links.ts')
for (const forbiddenLink of [
  'github.com/ax-studio/ax-studio',
  'axstudio.ai/docs',
]) {
  if (linksSource.includes(forbiddenLink)) {
    fail(`public links must not reference ${forbiddenLink}`)
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(
  'Microsoft Store release configuration is valid: offline NSIS x64/ARM64 submission lane',
)
