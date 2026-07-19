#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const value = process.argv[index + 1]

  if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
    console.error(`usage: node scripts/release/write-homebrew-cask.mjs --version <version> --sha256 <sha256> --out <path>`)
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

const version = required('version')
const sha256 = required('sha256')
const outPath = path.resolve(repoRoot, required('out'))

if (!/^[0-9a-f]{64}$/i.test(sha256)) {
  console.error(`sha256 must be a 64-character hex digest, got: ${sha256}`)
  process.exit(2)
}

const cask = `cask "ax-studio" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/defai-digital/ax-studio/releases/download/v#{version}/AX.Studio_#{version}_aarch64.dmg"
  name "AX Studio"
  desc "AI workspace for cloud models, local inference, tools, and research"
  homepage "https://github.com/defai-digital/ax-studio"

  depends_on arch: :arm64
  depends_on macos: :sequoia

  preflight do
    # Clears any pre-existing bundle (current or pre-rename "Ax-Studio.app" name) so
    # upgrades from untracked installs don't hit Homebrew's "already an App" guard.
    [
      "#{appdir}/AX Studio.app",
      "#{appdir}/Ax-Studio.app",
    ].each { |legacy_app| FileUtils.rm_rf(legacy_app) }
  end

  app "AX Studio.app"

  zap trash: [
    "~/Library/Application Support/AX Studio",
    "~/Library/Application Support/Ax-Studio",
    "~/Library/Caches/ai.axstudio.app",
    "~/Library/Logs/AX Studio",
    "~/Library/Logs/Ax-Studio",
    "~/Library/Preferences/ai.axstudio.app.plist",
    "~/Library/Saved Application State/ai.axstudio.app.savedState",
  ]
end
`

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, cask)
console.log(`wrote ${path.relative(repoRoot, outPath)}`)
