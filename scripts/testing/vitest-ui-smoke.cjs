// Run with Electron and AX_STUDIO_TEST_NODE pointing to the supported Node 24
// executable. Uses an isolated profile and a loopback-only Vitest server.
const { app, BrowserWindow } = require('electron')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '../..')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ax-vitest-ui-')))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let runner, win, output = ''
const errors = []
function cleanup() {
  if (runner && runner.exitCode === null) {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(runner.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else runner.kill('SIGTERM')
  }
}
const deadline = setTimeout(() => { console.error('Vitest UI smoke timed out'); cleanup(); app.exit(1) }, 180000)
;(async () => {
  const probe = net.createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  assert.ok(process.env.AX_STUDIO_TEST_NODE, 'AX_STUDIO_TEST_NODE is required')
  runner = spawn(process.env.AX_STUDIO_TEST_NODE, [
    path.join(repo, 'node_modules/vitest/vitest.mjs'), '--ui', '--watch',
    '--api.host=127.0.0.1', `--api.port=${port}`, '--api.strictPort',
    'scripts/testing/mlx-runtime-probe.test.mjs',
  ], { cwd: repo, windowsHide: true, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  runner.on('error', (error) => { errors.push(error.message) })
  runner.stdout.on('data', (chunk) => { output += chunk })
  runner.stderr.on('data', (chunk) => { output += chunk })
  // The HTTP UI and its WebSocket API require the per-run token.
  let authenticatedUrl
  for (;;) {
    if (errors.length || runner.exitCode !== null) throw new Error(`Vitest stopped: ${output}`)
    authenticatedUrl = output.match(/UI started at (http:\/\/127\.0\.0\.1:\d+\/__vitest__\/\?token=[^\s]+)/)?.[1]
    try {
      if (authenticatedUrl) {
        // The token bootstrap returns 302 plus a cookie. Let Chromium follow
        // that redirect with its cookie jar; Node fetch has no cookie jar.
        const response = await fetch(authenticatedUrl, { redirect: 'manual' })
        if (response.ok || response.status === 302) break
      }
    } catch {}
    await sleep(100)
  }
  await app.whenReady()
  win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason))
  // Vitest 5 protects its browser WebSocket API with a per-run token. Use
  // the startup URL rather than disabling API authentication for the test.
  await win.loadURL(authenticatedUrl)
  console.log('Vitest UI browser loaded')
  for (;;) {
    const ready = await win.webContents.executeJavaScript(`document.body.innerText.includes('mlx-runtime-probe.test.mjs') && !!document.querySelector('[aria-label="Run current file"]:not([disabled])')`)
    if (ready && /Tests\s+\d+ passed/.test(output)) break
    await sleep(100)
  }
  console.log('Vitest UI initial results verified')
  const before = (output.match(/Tests\s+\d+ passed/g) || []).length
  await win.webContents.executeJavaScript(`document.querySelector('[aria-label="Run current file"]').click()`)
  console.log('Vitest UI rerun requested')
  while ((output.match(/Tests\s+\d+ passed/g) || []).length <= before) await sleep(100)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ success: true, checks: ['Vitest 5 UI loaded', 'test file visible', 'initial tests passed', 'UI Run current file executed tests successfully'] }))
  clearTimeout(deadline)
  cleanup()
  app.exit(0)
})().catch((error) => { console.error(error, output.slice(-3000)); clearTimeout(deadline); cleanup(); app.exit(1) })
