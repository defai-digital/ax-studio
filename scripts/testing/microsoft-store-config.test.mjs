import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(path, 'utf8')

describe('Microsoft Store release boundary', () => {
  it('passes the Store configuration validator', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/release/validate-microsoft-store-config.mjs'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    expect(result.stderr).toBe('')
    expect(result.status, result.stdout).toBe(0)
    expect(result.stdout).toContain('Microsoft Store release configuration is valid')
  })

  it('keeps the offline Store override separate from the normal Windows build', () => {
    const normalConfig = JSON.parse(read('src-tauri/tauri.windows.conf.json'))
    const storeConfig = JSON.parse(read('src-tauri/tauri.microsoftstore.conf.json'))

    expect(normalConfig.bundle.windows.webviewInstallMode.type).toBe(
      'downloadBootstrapper',
    )
    expect(storeConfig.bundle.targets).toEqual(['nsis'])
    expect(storeConfig.bundle.windows.webviewInstallMode.type).toBe(
      'offlineInstaller',
    )
  })

  it('requires signed install, launch, and uninstall smoke coverage', () => {
    const smokeTest = read('scripts/release/test-microsoft-store-installer.ps1')

    expect(smokeTest).toContain('Get-AuthenticodeSignature')
    expect(smokeTest).toContain("-ArgumentList '/S'")
    expect(smokeTest).toContain('Get-AxStudioUninstallEntry')
    expect(smokeTest).toContain('Invoke-AxStudioUninstall -Entry')
  })

  it('does not allow Store artifacts to be overwritten in place', () => {
    const workflow = read('.github/workflows/ax-studio-microsoft-store-build.yml')

    expect(workflow).not.toContain('--clobber')
    expect(workflow).toContain('AX.Studio_${VERSION}_x64-store-setup.exe')
    expect(workflow).toContain('AX.Studio_${VERSION}_arm64-store-setup.exe')
  })
})
