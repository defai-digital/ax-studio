import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import fs, { copyFileSync, mkdirSync } from 'fs'
import https from 'https'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import unzipper from 'unzipper'
import { x as tarExtract } from 'tar'

const BUN_VERSION = '1.3.14'
const UV_VERSION = '0.11.26'
const MAX_REDIRECTS = 5

// Digests published by GitHub for the pinned upstream release assets.
const BUN_SHA256 = {
  'darwin-aarch64': 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
  'darwin-x64': '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633',
  'linux-aarch64': 'a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b',
  'linux-x64': '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f',
  'windows-aarch64': '89841f5a57f2348b67ec0839b718f4bf4ea7d07c371c9ba4b77b6c790f918953',
  'windows-x64': '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922',
}

const UV_SHA256 = {
  'aarch64-apple-darwin': '8f7fbf1708399b921857bce71e1d60f0d3ccf52a30caebc1c1a2f175dce13ab6',
  'x86_64-apple-darwin': '922b460202707dd5f4ccacbadbe7f6a546cc46e82a99bf50ca99a7977a78eddd',
  'aarch64-unknown-linux-gnu': 'befa1a59c91e96eb601b0fd9a97c03dd666f17baba644b2b4db9c59a767e387e',
  'x86_64-unknown-linux-gnu': '6426a73c3837e6e2483ee344cbc00f36394d179afcba6183cb77437e67db4af0',
  'aarch64-pc-windows-msvc': '98246149741f558e25e45ecf2b0b20f34de0634269f2bf0dcb4012d4b6ba289a',
  'x86_64-pc-windows-msvc': '4e1278ede866be6c0bf32d2f466cc6de7a9fb399ecf20c9ce2d186e52424be47',
}

function displayUrl(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split('?')[0]
  }
}

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while downloading '${url}'`))
      return
    }

    console.log(`Downloading ${displayUrl(url)} to ${dest}`)
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0
      console.log(`Response status code: ${statusCode}`)

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).toString()
        response.resume()
        console.log(`Redirecting to ${displayUrl(redirectUrl)}`)
        resolve(download(redirectUrl, dest, redirectCount + 1))
        return
      }

      if (statusCode !== 200) {
        response.resume()
        reject(new Error(`Failed to get '${url}' (${statusCode})`))
        return
      }

      const file = fs.createWriteStream(dest)
      const cleanupAndReject = (error) => {
        file.destroy()
        fs.rm(dest, { force: true }, () => reject(error))
      }

      response.on('error', cleanupAndReject)
      file.on('error', cleanupAndReject)
      file.on('finish', () => {
        file.close((error) => {
          if (error) cleanupAndReject(error)
          else resolve()
        })
      })
      response.pipe(file)
    })

    request.on('error', (error) => reject(error))
  })
}

async function sha256(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function ensureVerifiedArchive(url, filePath, expectedSha256) {
  if (fs.existsSync(filePath)) {
    const cachedSha256 = await sha256(filePath)
    if (cachedSha256 === expectedSha256) return

    console.warn(`Removing cached archive with invalid SHA-256: ${filePath}`)
    fs.rmSync(filePath, { force: true })
  }

  await download(url, filePath)
  const actualSha256 = await sha256(filePath)
  if (actualSha256 !== expectedSha256) {
    fs.rmSync(filePath, { force: true })
    throw new Error(
      `SHA-256 mismatch for ${path.basename(filePath)}: expected ${expectedSha256}, got ${actualSha256}`
    )
  }
}

async function decompress(filePath, targetDir) {
  console.log(`Decompressing ${filePath} to ${targetDir}`)
  if (filePath.endsWith('.zip')) {
    await fs
      .createReadStream(filePath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .promise()
  } else if (filePath.endsWith('.tar.gz')) {
    await tarExtract({ file: filePath, cwd: targetDir })
  } else {
    throw new Error(`Unsupported archive format: ${filePath}`)
  }
}

function ensureDirectory(dir) {
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) {
    fs.rmSync(dir, { force: true })
  }
  mkdirSync(dir, { recursive: true })
}

function getPlatformArch() {
  const platform = os.platform()
  const arch = os.arch()
  const windowsTarget = process.env.AX_STUDIO_WINDOWS_TARGET?.trim()

  let bunPlatform, uvPlatform, targetTriple

  if (platform === 'darwin') {
    bunPlatform = arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x64'
    uvPlatform = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    targetTriple = uvPlatform
  } else if (platform === 'linux') {
    bunPlatform = arch === 'arm64' ? 'linux-aarch64' : 'linux-x64'
    uvPlatform = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
    targetTriple = uvPlatform
  } else if (platform === 'win32') {
    const supportedTargets = ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']
    if (windowsTarget && !supportedTargets.includes(windowsTarget)) {
      throw new Error(`Unsupported AX_STUDIO_WINDOWS_TARGET: ${windowsTarget}`)
    }

    targetTriple = windowsTarget || (arch === 'arm64' ? supportedTargets[1] : supportedTargets[0])
    bunPlatform = targetTriple === supportedTargets[1] ? 'windows-aarch64' : 'windows-x64'
    uvPlatform = targetTriple
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  return { bunPlatform, uvPlatform, targetTriple }
}

function assertFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Expected bundled binary is missing: ${filePath}`)
  }
}

async function extractPinnedArchive({ url, archivePath, expectedSha256, extractDir }) {
  await ensureVerifiedArchive(url, archivePath, expectedSha256)
  fs.rmSync(extractDir, { recursive: true, force: true })
  ensureDirectory(extractDir)
  await decompress(archivePath, extractDir)
}

async function prepareBun(bunPlatform, platform, targetTriple, tempBinDir, binDir) {
  const archiveName = `bun-${bunPlatform}.zip`
  const archivePath = path.join(tempBinDir, `bun-v${BUN_VERSION}-${bunPlatform}.zip`)
  const extractDir = path.join(tempBinDir, `bun-v${BUN_VERSION}-${bunPlatform}`)
  const expectedSha256 = BUN_SHA256[bunPlatform]
  if (!expectedSha256) throw new Error(`Missing Bun digest for ${bunPlatform}`)

  await extractPinnedArchive({
    url: `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${archiveName}`,
    archivePath,
    expectedSha256,
    extractDir,
  })

  const executableName = platform === 'win32' ? 'bun.exe' : 'bun'
  const source = path.join(extractDir, `bun-${bunPlatform}`, executableName)
  const destination = path.join(binDir, executableName)
  assertFile(source)
  copyFileSync(source, destination)

  const targetDestination = path.join(
    binDir,
    platform === 'win32' ? `bun-${targetTriple}.exe` : `bun-${targetTriple}`
  )
  copyFileSync(source, targetDestination)
  if (platform !== 'win32') {
    fs.chmodSync(destination, 0o755)
    fs.chmodSync(targetDestination, 0o755)
  }

  return { source, destination, targetDestination }
}

async function prepareUv(uvPlatform, platform, targetTriple, tempBinDir, binDir) {
  const extension = platform === 'win32' ? 'zip' : 'tar.gz'
  const archiveName = `uv-${uvPlatform}.${extension}`
  const archivePath = path.join(tempBinDir, `uv-v${UV_VERSION}-${uvPlatform}.${extension}`)
  const extractDir = path.join(tempBinDir, `uv-v${UV_VERSION}-${uvPlatform}`)
  const expectedSha256 = UV_SHA256[uvPlatform]
  if (!expectedSha256) throw new Error(`Missing uv digest for ${uvPlatform}`)

  await extractPinnedArchive({
    url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archiveName}`,
    archivePath,
    expectedSha256,
    extractDir,
  })

  const executableName = platform === 'win32' ? 'uv.exe' : 'uv'
  const source = resolveUvExecutableSource(
    extractDir,
    uvPlatform,
    platform,
  )
  const destination = path.join(binDir, executableName)
  assertFile(source)
  copyFileSync(source, destination)

  const targetDestination = path.join(
    binDir,
    platform === 'win32' ? `uv-${targetTriple}.exe` : `uv-${targetTriple}`
  )
  copyFileSync(source, targetDestination)
  if (platform !== 'win32') {
    fs.chmodSync(destination, 0o755)
    fs.chmodSync(targetDestination, 0o755)
  }

  return { source, destination, targetDestination }
}

/**
 * uv's Windows ZIPs place uv.exe at the archive root, while Unix tarballs
 * contain a uv-<target>/ directory. Keep the upstream layouts explicit so a
 * Windows release cannot silently depend on the Unix archive shape.
 */
export function resolveUvExecutableSource(extractDir, uvPlatform, platform) {
  const executableName = platform === 'win32' ? 'uv.exe' : 'uv'
  return platform === 'win32'
    ? path.join(extractDir, executableName)
    : path.join(extractDir, `uv-${uvPlatform}`, executableName)
}

async function prepareMacUniversalBinary({ name, version, platforms, hashes, tempBinDir, binDir }) {
  const sources = []
  for (const platformName of platforms) {
    const archiveName = `${name}-${platformName}.${name === 'bun' ? 'zip' : 'tar.gz'}`
    const archivePath = path.join(tempBinDir, `${name}-v${version}-${platformName}.${name === 'bun' ? 'zip' : 'tar.gz'}`)
    const extractDir = path.join(tempBinDir, `${name}-v${version}-${platformName}`)
    const releaseTag = name === 'bun' ? `bun-v${version}` : version
    const repository = name === 'bun' ? 'oven-sh/bun' : 'astral-sh/uv'

    await extractPinnedArchive({
      url: `https://github.com/${repository}/releases/download/${releaseTag}/${archiveName}`,
      archivePath,
      expectedSha256: hashes[platformName],
      extractDir,
    })

    const source = path.join(extractDir, `${name}-${platformName}`, name)
    assertFile(source)
    sources.push(source)
    const triple = platformName.includes('aarch64') ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    const target = path.join(binDir, `${name}-${triple}`)
    copyFileSync(source, target)
    fs.chmodSync(target, 0o755)
  }

  const universalTarget = path.join(binDir, `${name}-universal-apple-darwin`)
  execFileSync('lipo', ['-create', ...sources, '-output', universalTarget], { stdio: 'inherit' })
  fs.chmodSync(universalTarget, 0o755)
  assertFile(universalTarget)
}

async function main() {
  if (process.env.SKIP_BINARIES) {
    console.log('Skipping binaries download.')
    return
  }

  const platform = os.platform()
  const { bunPlatform, uvPlatform, targetTriple } = getPlatformArch()
  const binDir = 'src-tauri/resources/bin'
  const tempBinDir = 'scripts/dist'
  ensureDirectory(tempBinDir)
  ensureDirectory(binDir)

  console.log(`Preparing Bun ${BUN_VERSION} for ${bunPlatform}...`)
  const bun = await prepareBun(bunPlatform, platform, targetTriple, tempBinDir, binDir)
  console.log(`Preparing uv ${UV_VERSION} for ${uvPlatform}...`)
  const uv = await prepareUv(uvPlatform, platform, targetTriple, tempBinDir, binDir)

  if (platform === 'darwin') {
    await prepareMacUniversalBinary({
      name: 'bun',
      version: BUN_VERSION,
      platforms: ['darwin-aarch64', 'darwin-x64'],
      hashes: BUN_SHA256,
      tempBinDir,
      binDir,
    })
    await prepareMacUniversalBinary({
      name: 'uv',
      version: UV_VERSION,
      platforms: ['aarch64-apple-darwin', 'x86_64-apple-darwin'],
      hashes: UV_SHA256,
      tempBinDir,
      binDir,
    })
  }

  for (const filePath of [bun.destination, bun.targetDestination, uv.destination, uv.targetDestination]) {
    assertFile(filePath)
  }
  console.log('Verified binary downloads completed.')
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  main().catch((error) => {
    console.error('Error:', error)
    process.exitCode = 1
  })
}
