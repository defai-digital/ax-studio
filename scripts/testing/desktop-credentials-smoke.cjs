// Run with the repository Electron binary after build:electron.
// Uses a fresh, isolated profile and synthetic credentials; never reads user data.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow } = require('electron')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-credentials-smoke-'))
app.setPath('userData', profile)
const sentinel = 'synthetic-credential-smoke-only'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let win
const deadline = setTimeout(() => app.exit(1), 90000)
;(async () => {
  const { registerAxStudioBridge } = await import(
    pathToFileURL(path.resolve(__dirname, '../../electron/dist/embed.js')).href
  )
  const bridge = await registerAxStudioBridge({
    dataFolder: path.join(profile, 'data'),
    getMainWindow: () => win,
  })
  win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: bridge.getPreloadPath(),
      additionalArguments: ['--ax-smoke'],
    },
  })
  const evaluate = (code) => win.webContents.executeJavaScript(code)
  await win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
  await sleep(4000)
  const payload = {
    version: 10,
    state: {
      providers: [
        {
          provider: 'openai',
          name: 'OpenAI',
          active: true,
          api_key: sentinel,
          base_url: 'https://api.openai.com/v1',
          models: [{ id: 'fixture', name: 'fixture' }],
          settings: [
            {
              key: 'api-key',
              title: 'API Key',
              controller_type: 'input',
              controller_props: { value: sentinel },
            },
          ],
        },
      ],
      selectedProvider: 'openai',
      selectedModel: { id: 'fixture', name: 'fixture' },
    },
  }
  await evaluate(
    `localStorage.setItem('model-provider', ${JSON.stringify(JSON.stringify(payload))})`
  )
  await win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
  await sleep(10000)
  assert.equal(
    (await evaluate(`localStorage.getItem('model-provider')`)).includes(
      sentinel
    ),
    false
  )
  const disk = fs.readFileSync(path.join(profile, 'secrets.json'), 'utf8')
  assert.equal(disk.includes(sentinel), false)
  assert.ok(JSON.parse(disk)['model-provider-credentials'].startsWith('enc:'))
  assert.equal(
    await evaluate(
      `(async () => JSON.parse(await window.axElectron.invoke('get_secret', {key:'model-provider-credentials'})).openai === ${JSON.stringify(sentinel)})()`
    ),
    true
  )
  await win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
  await sleep(10000)
  const registered = await evaluate(
    `window.axElectron.invoke('list_provider_configs')`
  )
  assert.ok(registered.some((p) => p.provider === 'openai' && p.has_api_key))
  assert.equal(
    (await evaluate(`localStorage.getItem('model-provider')`)).includes(
      sentinel
    ),
    false
  )
  console.log(
    JSON.stringify({
      success: true,
      checks: [
        'legacy key scrubbed',
        'OS encrypted on disk',
        'secure value preserved',
        'provider restored after reload and startup refresh',
      ],
    })
  )
  clearTimeout(deadline)
  app.exit(0)
})().catch((error) => {
  console.error(error)
  clearTimeout(deadline)
  app.exit(1)
})
