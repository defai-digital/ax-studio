import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Xcode 26 can resolve TOOLCHAIN_DIR to the transient Metal cryptex toolchain.
// Tauri's generated project uses that variable for Swift compatibility libs;
// those libs live in the stable XcodeDefault toolchain instead.
if (process.platform === 'darwin') {
  const developerDir = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim()
  const cwdProject = join(process.cwd(), 'src-tauri/gen/apple/ax-studio.xcodeproj/project.pbxproj')
  if (existsSync(cwdProject)) {
    const toolchain = `${developerDir}/Toolchains/XcodeDefault.xctoolchain`
    const before = readFileSync(cwdProject, 'utf8')
    const after = before.replaceAll('$(TOOLCHAIN_DIR)', toolchain)
    if (after !== before) writeFileSync(cwdProject, after)
  }
}
