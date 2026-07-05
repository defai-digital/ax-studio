// scripts/download.js
import https from 'https'
import fs, { copyFileSync, cpSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
import unzipper from 'unzipper'
import { x as tarExtract } from 'tar'

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} to ${dest}`)
    const file = fs.createWriteStream(dest)
    https
      .get(url, (response) => {
        console.log(`Response status code: ${response.statusCode}`)
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          // Handle redirect
          const redirectURL = response.headers.location
          console.log(`Redirecting to ${redirectURL}`)
          download(redirectURL, dest).then(resolve, reject) // Recursive call
          return
        } else if (response.statusCode !== 200) {
          reject(`Failed to get '${url}' (${response.statusCode})`)
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close(resolve)
        })
      })
      .on('error', (err) => {
        fs.unlink(dest, () => reject(err.message))
      })
  })
}

async function decompress(filePath, targetDir) {
  console.log(`Decompressing ${filePath} to ${targetDir}`)
  if (filePath.endsWith('.zip')) {
    await fs
      .createReadStream(filePath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .promise()
  } else if (filePath.endsWith('.tar.gz')) {
    await tarExtract({
      file: filePath,
      cwd: targetDir,
    })
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
  const platform = os.platform() // 'darwin', 'linux', 'win32'
  const arch = os.arch() // 'x64', 'arm64', etc.
  const windowsTarget = process.env.AX_STUDIO_WINDOWS_TARGET?.trim()

  let bunPlatform, uvPlatform, targetTriple

  if (platform === 'darwin') {
    bunPlatform = arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x64'
    uvPlatform =
      arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    targetTriple = uvPlatform
  } else if (platform === 'linux') {
    bunPlatform = arch === 'arm64' ? 'linux-aarch64' : 'linux-x64'
    uvPlatform =
      arch === 'arm64'
        ? 'aarch64-unknown-linux-gnu'
        : 'x86_64-unknown-linux-gnu'
    targetTriple = uvPlatform
  } else if (platform === 'win32') {
    if (windowsTarget && !['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'].includes(windowsTarget)) {
      throw new Error(`Unsupported AX_STUDIO_WINDOWS_TARGET: ${windowsTarget}`)
    }

    targetTriple =
      windowsTarget || (arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc')
    bunPlatform = targetTriple === 'aarch64-pc-windows-msvc' ? 'windows-aarch64' : 'windows-x64'
    uvPlatform = targetTriple
  } else {
    throw new Error(`Unsupported platform: ${platform}`)
  }

  return { bunPlatform, uvPlatform, targetTriple }
}

async function main() {
  if (process.env.SKIP_BINARIES) {
    console.log('Skipping binaries download.')
    process.exit(0)
  }
  console.log('Starting main function')
  const platform = os.platform()
  const { bunPlatform, uvPlatform, targetTriple } = getPlatformArch()
  console.log(`bunPlatform: ${bunPlatform}, uvPlatform: ${uvPlatform}`)

  const binDir = 'src-tauri/resources/bin'
  const tempBinDir = 'scripts/dist'
  const bunPath = `${tempBinDir}/bun-${bunPlatform}.zip`
  let uvPath = `${tempBinDir}/uv-${uvPlatform}.tar.gz`
  if (platform === 'win32') {
    uvPath = `${tempBinDir}/uv-${uvPlatform}.zip`
  }
  ensureDirectory(tempBinDir)
  ensureDirectory(binDir)

  // Adjust these URLs based on latest releases
  const bunUrl = `https://github.com/oven-sh/bun/releases/latest/download/bun-${bunPlatform}.zip`

  let uvUrl = `https://github.com/astral-sh/uv/releases/latest/download/uv-${uvPlatform}.tar.gz`
  if (platform === 'win32') {
    uvUrl = `https://github.com/astral-sh/uv/releases/latest/download/uv-${uvPlatform}.zip`
  }

  console.log(`Downloading Bun for ${bunPlatform}...`)
  const bunSaveDir = path.join(tempBinDir, `bun-${bunPlatform}.zip`)
  if (!fs.existsSync(bunSaveDir)) {
    await download(bunUrl, bunSaveDir)
    await decompress(bunPath, tempBinDir)
  }
  try {
    cpSync(
      path.join(tempBinDir, `bun-${bunPlatform}`, 'bun'),
      path.join(binDir, 'bun')
    )
    fs.chmodSync(path.join(binDir, 'bun'), 0o755)
    if (platform === 'darwin') {
      copyFileSync(
        path.join(binDir, 'bun'),
        path.join(binDir, 'bun-x86_64-apple-darwin')
      )
      copyFileSync(
        path.join(binDir, 'bun'),
        path.join(binDir, 'bun-aarch64-apple-darwin')
      )
      copyFileSync(
        path.join(binDir, 'bun'),
        path.join(binDir, 'bun-universal-apple-darwin')
      )
    } else if (platform === 'linux') {
      copyFileSync(
        path.join(binDir, 'bun'),
        path.join(binDir, 'bun-x86_64-unknown-linux-gnu')
      )
    }
  } catch (err) {
    // Expect EEXIST error
  }
  try {
    cpSync(
      path.join(tempBinDir, `bun-${bunPlatform}`, 'bun.exe'),
      path.join(binDir, 'bun.exe')
    )
    if (platform === 'win32') {
      copyFileSync(
        path.join(binDir, 'bun.exe'),
        path.join(binDir, `bun-${targetTriple}.exe`)
      )
    }
  } catch (err) {
    // Expect EEXIST error
  }
  console.log('Bun downloaded.')

  console.log(`Downloading UV for ${uvPlatform}...`)
  const uvExt = platform === 'win32' ? `zip` : `tar.gz`
  const uvSaveDir = path.join(tempBinDir, `uv-${uvPlatform}.${uvExt}`)
  if (!fs.existsSync(uvSaveDir)) {
    await download(uvUrl, uvSaveDir)
    await decompress(uvPath, tempBinDir)
  }
  try {
    cpSync(path.join(tempBinDir, `uv-${uvPlatform}`, 'uv'), path.join(binDir, 'uv'))
    fs.chmodSync(path.join(binDir, 'uv'), 0o755)
    if (platform === 'darwin') {
      copyFileSync(
        path.join(binDir, 'uv'),
        path.join(binDir, 'uv-x86_64-apple-darwin')
      )
      copyFileSync(
        path.join(binDir, 'uv'),
        path.join(binDir, 'uv-aarch64-apple-darwin')
      )
      copyFileSync(
        path.join(binDir, 'uv'),
        path.join(binDir, 'uv-universal-apple-darwin')
      )
    } else if (platform === 'linux') {
      copyFileSync(
        path.join(binDir, 'uv'),
        path.join(binDir, 'uv-x86_64-unknown-linux-gnu')
      )
    }
  } catch (err) {
    // Expect EEXIST error
  }
  try {
    cpSync(path.join(tempBinDir, 'uv.exe'), path.join(binDir, 'uv.exe'))
    if (platform === 'win32') {
      copyFileSync(
        path.join(binDir, 'uv.exe'),
        path.join(binDir, `uv-${targetTriple}.exe`)
      )
    }
  } catch (err) {
    // Expect EEXIST error
  }
  console.log('UV downloaded.')

  console.log('Downloads completed.')
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
