/**
 * Generate winget multi-file manifests for AX Studio NSIS installers.
 *
 * Usage:
 *   node scripts/release/write-winget-manifest.mjs \
 *     --version 2.2.0 \
 *     --x64-sha256 <hex64> \
 *     --arm64-sha256 <hex64> \
 *     --out-dir packaging/winget/manifests
 *
 * Does not publish to microsoft/winget-pkgs. See packaging/winget/README.md.
 *
 * Note: no shebang — this module is imported by Vitest on Windows, and a
 * leading #! line becomes a SyntaxError under Vitest's thread pool loader.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

/**
 * winget-pkgs multi-file layout: manifests/<first>/<Publisher>/<Package>/<version>/
 * PackageIdentifier "DEFAI.AXStudio" -> d/DEFAI/AXStudio
 */
export function wingetPackageRelativeDir(identifier) {
  const parts = String(identifier || '').split('.').filter(Boolean)
  if (parts.length < 2) {
    throw new Error(
      `packageIdentifier must look like Publisher.Package (got: ${identifier})`,
    )
  }
  const firstLetter = parts[0][0].toLowerCase()
  return path.join(firstLetter, ...parts)
}

function main(argv) {
  const args = new Map()

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]

    if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
      console.error(
        'usage: node scripts/release/write-winget-manifest.mjs --version <version> --x64-sha256 <hex> --arm64-sha256 <hex> --out-dir <path>',
      )
      process.exit(2)
    }

    args.set(key.slice(2), value)
    index += 1
  }

  function required(name) {
    const value = args.get(name)
    if (!value) {
      console.error(`missing required argument: --${name}`)
      process.exit(2)
    }
    return value
  }

  function assertSha256(name, value) {
    if (!/^[0-9a-f]{64}$/i.test(value)) {
      console.error(`${name} must be a 64-character hex digest, got: ${value}`)
      process.exit(2)
    }
    return value.toUpperCase()
  }

  const version = required('version')
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`version must look like 2.2.0, got: ${version}`)
    process.exit(2)
  }

  const x64Sha256 = assertSha256('x64-sha256', required('x64-sha256'))
  const arm64Sha256 = assertSha256('arm64-sha256', required('arm64-sha256'))
  const outDir = path.resolve(repoRoot, required('out-dir'))
  const releaseDate = args.get('release-date') || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    console.error(`release-date must look like YYYY-MM-DD, got: ${releaseDate}`)
    process.exit(2)
  }

  const certMetadata = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'docs/release/windows-cert.json'), 'utf8'),
  )
  const packageIdentifier = certMetadata.packageIdentifier || 'DEFAI.AXStudio'
  const publisher = certMetadata.publisher || 'DEFAI Private Limited'
  const packageUrl = 'https://github.com/defai-digital/ax-studio'
  const licenseUrl = `${packageUrl}/blob/main/LICENSE`
  const releaseNotesUrl = `${packageUrl}/releases/tag/v${version}`

  const x64Installer = `AX.Studio_${version}_x64-setup.exe`
  const arm64Installer = `AX.Studio_${version}_arm64-setup.exe`
  const x64Url = `${packageUrl}/releases/download/v${version}/${x64Installer}`
  const arm64Url = `${packageUrl}/releases/download/v${version}/${arm64Installer}`

  const versionDir = path.join(
    outDir,
    wingetPackageRelativeDir(packageIdentifier),
    version,
  )

  const versionManifest = `PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`

  const localeManifest = `PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ${publisher}
PublisherUrl: https://axstudio.ai
PublisherSupportUrl: ${packageUrl}/issues
Author: ${publisher}
PackageName: AX Studio
PackageUrl: ${packageUrl}
License: Apache-2.0
LicenseUrl: ${licenseUrl}
Copyright: Copyright (c) ${publisher}
ShortDescription: AI workspace for cloud models, local inference, tools, and research
Description: >-
  AX Studio is a local-first desktop AI workspace for cloud providers, local
  inference, tools, MCP, and research workflows. Install only from official
  signed packages; do not use third-party remote install scripts.
Moniker: ax-studio
Tags:
  - ai
  - desktop
  - llm
  - local-ai
  - tauri
ReleaseNotesUrl: ${releaseNotesUrl}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`

  const installerManifest = `PackageIdentifier: ${packageIdentifier}
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: nullsoft
Scope: machine
InstallModes:
  - interactive
  - silent
  - silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${releaseDate}
Installers:
  - Architecture: x64
    InstallerUrl: ${x64Url}
    InstallerSha256: ${x64Sha256}
    InstallerType: nullsoft
  - Architecture: arm64
    InstallerUrl: ${arm64Url}
    InstallerSha256: ${arm64Sha256}
    InstallerType: nullsoft
ManifestType: installer
ManifestVersion: 1.6.0
`

  fs.mkdirSync(versionDir, { recursive: true })

  const files = [
    [`${packageIdentifier}.yaml`, versionManifest],
    [`${packageIdentifier}.locale.en-US.yaml`, localeManifest],
    [`${packageIdentifier}.installer.yaml`, installerManifest],
  ]

  for (const [fileName, content] of files) {
    const filePath = path.join(versionDir, fileName)
    fs.writeFileSync(filePath, content)
    console.log(`wrote ${path.relative(repoRoot, filePath)}`)
  }

  console.log(`winget manifests ready under ${path.relative(repoRoot, versionDir)}`)
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  main(process.argv.slice(2))
}
