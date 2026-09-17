// Run with Electron after build:electron. All model traffic stays on a local
// fixture server; --real-ollama forwards through it to local qwen3:4b with a
// 64-token response cap. Profiles, threads, and settings remain isolated.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow } = require('electron')
const realOllama = process.argv.includes('--real-ollama')
const sequentialTurns = process.argv.includes('--stress') ? 50 : 5
const modelId = (index) => (realOllama ? 'qwen3:4b' : `fixture-${index}`)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-four-issues-'))
app.setPath('userData', profile)
const repo = path.resolve(__dirname, '../..')
const data = path.join(profile, 'data')
const ids = ['01M24NNK0GQ25PM89X134E60W9', '01M24NQ3C9408V6ZMBQAEPK7TJ']
const requests = [],
  errors = [],
  checks = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let win
const deadline = setTimeout(
  () => {
    console.error('Smoke timed out')
    app.exit(1)
  },
  realOllama ? 420000 : 180000
)
for (const [index, id] of ids.entries()) {
  const dir = path.join(data, 'threads', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'thread.json'),
    JSON.stringify({
      id,
      title: `Pane ${index}`,
      model: { id: modelId(index), provider: 'ollama' },
      assistants: [
        {
          id: 'model-only',
          name: 'Model',
          model: { id: modelId(index), engine: 'ollama' },
          tools: [],
        },
      ],
      metadata: {},
      created: 1,
      updated: 1,
    })
  )
  fs.writeFileSync(path.join(dir, 'messages.jsonl'), '')
}
;(async () => {
  const { registerAxStudioBridge } = await import(
    pathToFileURL(path.join(repo, 'electron/dist/embed.js')).href
  )
  const bridge = await registerAxStudioBridge({
    dataFolder: data,
    getMainWindow: () => win,
  })
  const upstream = http.createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (!raw) {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({ data: [{ id: 'fixture-0' }, { id: 'fixture-1' }] })
      )
      return
    }
    const body = JSON.parse(raw)
    requests.push(body)
    if (realOllama) {
      try {
        const response = await fetch(
          'http://127.0.0.1:11434/v1/chat/completions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, max_tokens: 64 }),
            signal: AbortSignal.timeout(120000),
          }
        )
        res.writeHead(response.status, {
          'Content-Type':
            response.headers.get('content-type') || 'application/json',
        })
        for await (const chunk of response.body) res.write(chunk)
        res.end()
      } catch (error) {
        errors.push(String(error))
        res.destroy()
      }
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const answer = `Reply ${body.model} ${body.messages.filter((m) => m.role === 'user').length}`
    const frame = (delta, finish_reason = null) =>
      'data: ' +
      JSON.stringify({
        id: 'fixture',
        object: 'chat.completion.chunk',
        created: 1,
        model: body.model,
        choices: [{ index: 0, delta, finish_reason }],
      }) +
      '\n\n'
    for (const word of answer.split(' ')) {
      res.write(frame({ content: word + ' ' }))
      await sleep(80)
    }
    res.end(frame({}, 'stop') + 'data: [DONE]\n\n')
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const { startProxyServer } = await import(
    pathToFileURL(path.join(repo, 'electron/dist/server/proxy.js')).href
  )
  const port = await startProxyServer(
    '127.0.0.1',
    0,
    {
      host: '127.0.0.1',
      prefix: '/v1',
      proxyApiKey: '',
      corsEnabled: false,
      trustedHosts: [['localhost', '127.0.0.1']],
      verboseLogs: false,
    },
    60
  )
  win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 1000,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: bridge.getPreloadPath(),
      additionalArguments: ['--ax-smoke'],
    },
  })
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    errors.push(JSON.stringify(details))
  })
  const evaluate = (code) => win.webContents.executeJavaScript(code)
  const load = () =>
    win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
  const waitFor = async (code) => {
    for (let i = 0; i < (realOllama ? 1200 : 150); i++) {
      if (await evaluate(code)) return
      await sleep(100)
    }
    throw new Error('Condition timed out: ' + code)
  }
  await load()
  await sleep(10000)
  const models = [0, 1].map((index) => ({
    id: modelId(index),
    name: `Fixture ${index}`,
    settings: {
      ctx_len: {
        key: 'ctx_len',
        title: 'Context size',
        controller_type: 'input',
        controller_props: { type: 'number', value: 8192 },
      },
    },
  }))
  const provider = {
    provider: 'ollama',
    active: true,
    api_key: '',
    base_url: `http://127.0.0.1:${upstream.address().port}/v1`,
    models,
    settings: [],
  }
  await evaluate(
    `localStorage.setItem('model-provider',${JSON.stringify(JSON.stringify({ version: 10, state: { providers: [provider], selectedProvider: 'ollama', selectedModel: models[0], deletedModels: [] } }))});localStorage.setItem('setting-local-api-server',${JSON.stringify(JSON.stringify({ version: 0, state: { enableOnStartup: false, serverHost: '127.0.0.1', serverPort: port, apiPrefix: '/v1', apiKey: '', corsEnabled: false, trustedHosts: ['localhost', '127.0.0.1'], proxyTimeout: 60 } }))})`
  )
  await load()
  await sleep(10000)
  await evaluate(
    `sessionStorage.setItem('split-view-info',JSON.stringify({direction:'right',splitThreadId:'01M24NQ3C9408V6ZMBQAEPK7TJ'}));window.__ax.router.navigate({to:'/threads/$threadId',params:{threadId:'01M24NNK0GQ25PM89X134E60W9'}})`
  )
  await waitFor(
    `document.querySelectorAll('textarea[aria-label="Ask me anything..."]').length===2`
  )
  const send = async (pane, text) => {
    await evaluate(
      `(()=>{const input=document.querySelectorAll('textarea[aria-label="Ask me anything..."]')[${pane}];Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`
    )
    await sleep(50)
    await evaluate(
      `(()=>{let node=document.querySelectorAll('textarea[aria-label="Ask me anything..."]')[${pane}].parentElement;while(node&&!node.querySelector('button[aria-label="Send message"]'))node=node.parentElement;if(!node)throw new Error('No send button');node.querySelector('button[aria-label="Send message"]').click()})()`
    )
  }
  const idle = () =>
    waitFor(
      `document.querySelectorAll('button[aria-label="Send message"]').length===2 && !document.body.innerText.includes('Error generating response')`
    )
  for (let turn = 0; turn < sequentialTurns; turn++) {
    await send(1, `right question ${turn}`)
    await sleep(700)
    await idle()
  }
  await Promise.all([send(0, 'left question'), send(1, 'right parallel')])
  await sleep(700)
  await idle()
  assert.equal(requests.length, sequentialTurns + 2)
  const right = requests.filter(
    (request) =>
      request.messages.find((message) => message.role === 'user')?.content ===
      'right question 0'
  )
  assert.deepEqual(
    right.map(
      (request) =>
        request.messages.filter((message) => message.role === 'user').length
    ),
    Array.from({ length: sequentialTurns + 1 }, (_, index) => index + 1)
  )
  assert.equal(
    requests
      .find(
        (request) =>
          request.messages.find((message) => message.role === 'user')
            ?.content === 'left question'
      )
      .messages.filter((message) => message.role === 'user').length,
    1
  )
  checks.push(
    `split: ${sequentialTurns} consecutive turns plus concurrent turns, isolated model/history`
  )
  for (const [prompt, answer] of [
    ['2+2', '4'],
    ['9 + 8', '17'],
    ['9 - 8', '1'],
    ['14- 7 =', '7'],
  ]) {
    await send(1, prompt)
    await sleep(200)
    await idle()
    await waitFor(`document.body.innerText.includes(${JSON.stringify(prompt)})`)
    const stored = fs
      .readFileSync(
        path.join(data, 'threads', ids[1], 'messages.jsonl'),
        'utf8'
      )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const assistant = stored
      .filter((message) => message.role === 'assistant')
      .at(-1)
    assert.equal(
      assistant.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text.value)
        .join(''),
      answer
    )
  }
  assert.equal(requests.length, sequentialTurns + 2)
  checks.push(
    'arithmetic: four reported prompts persisted correct plain answers without model requests'
  )
  await evaluate(
    `document.querySelectorAll('button[aria-label^="Model Settings"]')[1].click()`
  )
  await waitFor(`!!document.querySelector('[data-slot="sheet-content"] input')`)
  assert.equal(
    await evaluate(`!!document.querySelector('[data-slot="popover-content"]')`),
    false
  )
  await evaluate(
    `(()=>{const input=document.querySelector('[data-slot="sheet-content"] input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'16384');input.dispatchEvent(new Event('input',{bubbles:true}));})()`
  )
  await sleep(200)
  assert.equal(
    await evaluate(
      `document.activeElement===document.querySelector('[data-slot="sheet-content"] input') && document.activeElement.value==='16384'`
    ),
    true
  )
  checks.push(
    'settings: context input retains focus and value, search popover stays closed'
  )
  await evaluate(
    `Array.from(document.querySelectorAll('[data-slot="sheet-content"] button')).find(button=>button.textContent==='Close').click()`
  )
  await waitFor(`!document.querySelector('[data-slot="sheet-content"]')`)
  await evaluate(
    `localStorage.setItem('search-query-history:models','["previous model search"]');document.querySelectorAll('button[aria-label^="Model Settings"]')[1].parentElement.querySelector('button[data-slot="popover-trigger"]').click()`
  )
  await waitFor(
    `!!document.querySelector('[data-slot="popover-content"] input')`
  )
  await evaluate(
    `(()=>{const input=document.querySelector('[data-slot="popover-content"] input');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'draft model search');input.dispatchEvent(new Event('input',{bubbles:true}));})()`
  )
  await sleep(100)
  await evaluate(
    `document.querySelector('[data-slot="popover-content"] input').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}))`
  )
  await waitFor(
    `document.querySelector('[data-slot="popover-content"] input')?.value==='previous model search'`
  )
  await evaluate(
    `document.querySelector('[data-slot="popover-content"] input').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))`
  )
  await waitFor(
    `document.querySelector('[data-slot="popover-content"] input')?.value==='draft model search'`
  )
  checks.push('search: keyboard recalls history and restores editable draft')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(
    JSON.stringify({
      success: true,
      mode: realOllama ? 'local qwen3:4b, max_tokens=64' : 'fixture',
      checks,
      requests: requests.length,
      rendererErrors: errors.length,
    })
  )
  clearTimeout(deadline)
  app.exit(0)
})().catch((error) => {
  console.error(error)
  clearTimeout(deadline)
  app.exit(1)
})
